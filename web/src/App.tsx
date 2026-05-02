import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./useSession";
import { sendMessage, fetchHealth, startReviewBatch } from "./api";
import { extractTodos } from "./parseDraft";
import { EditorPane } from "./components/editor/EditorPane";
import { useDraftAutoOpen } from "./lib/useDraftAutoOpen";
import { assistantText, assistantToolCalls } from "./types";
import { friendlyLabel, summarizeToolForLine, toolIconChar } from "./lib/toolLabels";
import { Header } from "./components/Header";
import { EmptyState } from "./components/EmptyState";
import { TodosBar } from "./components/TodosBar";
import { Thinking } from "./components/Thinking";
import { MessageBubble } from "./components/MessageBubble";
import { Toast } from "./components/Toast";
import { ChatInput } from "./components/ChatInput";

type Health = { ok: boolean; anthropicKey: boolean; wpConfigured: boolean };

export function App() {
  const { sessionId, messages, status, error, lastEventAt, appendUserMessage, newSession, reconnect } = useSession();
  // Watchdog: if the agent is supposedly running but hasn't emitted any
  // SSE event for >20 s, flag the stream as likely stalled.
  const stalled =
    status === "running" && lastEventAt > 0 && Date.now() - lastEventAt > 20_000;
  const [editorOpen, setEditorOpen] = useState(false);
  const draftAuto = useDraftAutoOpen(sessionId);
  useEffect(() => {
    if (draftAuto.shouldOpen && !editorOpen) setEditorOpen(true);
  }, [draftAuto.shouldOpen, editorOpen]);

  // ------- Activity tracking ------------------------------------------------
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);
  const silenceSec =
    status === "running" && lastEventAt > 0 ? Math.floor((now - lastEventAt) / 1000) : 0;

  const activity = useMemo(() => {
    if (status === "idle") return null;
    if (status === "connecting") return { icon: "⏳", text: "Connexion au stream…" };

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const running = [...assistantToolCalls(m)].reverse().find((t) => t.status === "running");
      if (running) {
        const summary = summarizeToolForLine(running);
        const verb = friendlyLabel(running).verb;
        return {
          icon: toolIconChar(running.name),
          text: summary || verb,
          mono: false,
        };
      }
      const fullText = assistantText(m);
      if (fullText) {
        const visible = fullText
          .replace(/```[\s\S]*?```/g, "")
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
          .replace(/`([^`]+)`/g, "$1")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[\s ]+/g, " ")
          .trim();
        const tail = visible.slice(-110).trim();
        if (tail) return { icon: "✍", text: "… " + tail };
      }
      break;
    }
    return { icon: "✻", text: "Réflexion…" };
  }, [messages, status]);

  // ------- Todos + phase ----------------------------------------------------
  const todos = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const t = extractTodos(assistantText(m));
      if (t.length > 0) return t;
    }
    return [];
  }, [messages]);

  const currentPhase = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const match = assistantText(m).match(
        /Phase\s*:?\s*\*{0,2}\s*(DISCOVER|PLAN|DRAFT|REVIEW|PUBLISH)\s*\*{0,2}/i,
      );
      if (match) return match[1].toUpperCase();
    }
    return null;
  }, [messages]);

  const [todosOpen, setTodosOpen] = useState(false);

  const [askAnswered, setAskAnswered] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ text: string; link?: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ------- Editor selection (shared with sendMessage so DOC_STATE.selection
  //         always reflects what the user has highlighted in the editor) ----
  const editorSelectionIds = useRef<string[]>([]);
  const [pendingAgentBlockIds, setPendingAgentBlockIds] = useState<string[]>([]);
  useEffect(() => {
    if (status === "idle") setPendingAgentBlockIds([]);
  }, [status]);

  // ------- Send handlers ----------------------------------------------------
  async function sendText(text: string) {
    if (!sessionId) return;
    appendUserMessage(text);
    if (editorSelectionIds.current.length > 0) {
      setPendingAgentBlockIds(editorSelectionIds.current.slice());
    }
    try {
      await sendMessage(sessionId, text, {
        selection_block_ids: editorSelectionIds.current,
      });
    } catch (err: any) {
      setToast({ text: `Erreur · ${err.message}` });
      setPendingAgentBlockIds([]);
    }
  }

  async function sendClick(label: string, value: string) {
    if (!sessionId) return;
    appendUserMessage(label);
    if (editorSelectionIds.current.length > 0) {
      setPendingAgentBlockIds(editorSelectionIds.current.slice());
    }
    try {
      await sendMessage(sessionId, value, {
        selection_block_ids: editorSelectionIds.current,
      });
    } catch (err: any) {
      setToast({ text: `Erreur · ${err.message}` });
      setPendingAgentBlockIds([]);
    }
  }

  async function answerAsk(
    askKey: string,
    label: string,
    value: string,
    option: { kind?: "review" },
  ) {
    if (askAnswered[askKey]) return;
    setAskAnswered((prev) => ({ ...prev, [askKey]: label }));

    // Special dispatch: kind:"review" options trigger the review pipeline
    // directly instead of round-tripping a text message to the agent.
    if (option.kind === "review" && sessionId) {
      const tag = value.replace(/^review:/, "");
      const kinds =
        tag === "all" || tag === "tous"
          ? ["legal", "fact", "links"]
          : tag === "legal" || tag === "fact" || tag === "links"
            ? [tag]
            : [];
      if (kinds.length === 0) {
        await sendClick(label, value);
        return;
      }
      setEditorOpen(true);
      try {
        await startReviewBatch(sessionId, kinds);
      } catch (err: any) {
        setToast({ text: `Erreur · ${err.message}` });
      }
      return;
    }

    await sendClick(label, value);
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary text-text-primary">
      <Header
        sessionId={sessionId}
        status={status}
        health={health}
        stalled={stalled}
        onReconnect={reconnect}
        onNewSession={() => {
          if (
            messages.length === 0 ||
            window.confirm(
              "Démarrer une nouvelle session ? L'historique reste dans Anthropic mais l'interface part à zéro.",
            )
          ) {
            setAskAnswered({});
            setEditorOpen(false);
            editorSelectionIds.current = [];
            draftAuto.reset();
            void newSession();
          }
        }}
      />

      {(todos.length > 0 || currentPhase) && (
        <TodosBar
          todos={todos}
          phase={currentPhase}
          open={todosOpen}
          onToggle={() => setTodosOpen((o) => !o)}
        />
      )}

      <div className="flex-1 min-h-0 flex">
      <main
        ref={scrollRef}
        className={`
          ${editorOpen
            ? "hidden md:block md:w-[320px] md:flex-shrink-0 lg:w-auto lg:basis-[58%] lg:flex-shrink lg:flex-grow-0 md:border-r md:border-border"
            : "flex-1"}
          min-h-0 overflow-auto
        `}
      >
        <div className={`mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-3 ${editorOpen ? "max-w-2xl" : "max-w-3xl"}`}>
          {error && (
            <div className="surface border-red-500/40 bg-red-500/10 text-red-300 text-sm rounded-md p-3">
              {error}
            </div>
          )}
          {health && !health.anthropicKey && (
            <div className="surface bg-amber-500/5 border-amber-500/30 text-amber-200 text-sm rounded-md p-3">
              <span className="font-medium">ANTHROPIC_API_KEY manquante</span> · ajoute-la dans{" "}
              <code className="font-mono text-xs">server/.env</code>
            </div>
          )}
          {messages.length === 0 && !error && (
            <EmptyState onPick={sendClick} disabled={!sessionId} />
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onAnswerAsk={(askIdx, label, value, opt) =>
                answerAsk(`${m.id}#${askIdx}`, label, value, opt)
              }
              askAnsweredFor={(askIdx) => askAnswered[`${m.id}#${askIdx}`]}
              onApprovePlan={() => sendClick("✓ vasy", "vasy")}
              disabled={false}
            />
          ))}
          {status === "running" && <Thinking activity={activity} silenceSec={silenceSec} />}
          {!editorOpen && (
            <div className="text-center pt-4">
              <button
                onClick={() => setEditorOpen(true)}
                className="text-xs text-text-tertiary hover:text-text-primary border border-border rounded-md px-3 py-1.5 transition-colors"
              >
                Ouvrir l'éditeur de blocs
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Editor — always mounted once sessionId exists; visibility via CSS. */}
      {sessionId && (
        <section
          className={`
            ${editorOpen ? "flex" : "hidden"}
            flex-1 min-h-0 min-w-0 flex-col
          `}
        >
          <EditorPane
            sessionId={sessionId}
            pendingAgentBlockIds={pendingAgentBlockIds}
            onClose={() => {
              setEditorOpen(false);
              draftAuto.reset();
            }}
            onPublished={(p) => {
              setToast({ text: `Publié · #${p.id}`, link: p.link });
            }}
            onToast={(t) => setToast({ text: t })}
            onSelectionChange={(ids) => {
              editorSelectionIds.current = ids;
            }}
            onQuickAction={(blockIds) => setPendingAgentBlockIds(blockIds)}
          />
        </section>
      )}
      </div>

      <ChatInput sessionId={sessionId} onSend={sendText} />

      {toast && <Toast toast={toast} />}
    </div>
  );
}
