import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./useSession";
import { sendMessage, publishDraft, fetchHealth } from "./api";
import { extractDrafts, extractTodos } from "./parseDraft";
import { PublishEditor } from "./components/PublishEditor";
import { EditorPane } from "./components/editor/EditorPane";
import { useDraftAutoOpen } from "./lib/useDraftAutoOpen";
import {
  type Mode,
  type PublishState,
  type WpDraft,
  assistantText,
  assistantToolCalls,
} from "./types";
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
  const { sessionId, messages, status, error, lastEventAt, appendUserMessage, newSession } = useSession();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeed, setEditorSeed] = useState<string | null>(null);
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

  // ------- Mode + askAnswered + publishedDrafts -----------------------------
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof localStorage === "undefined") return "auto";
    const saved = localStorage.getItem("mode");
    return saved === "validate" || saved === "auto" ? saved : "auto";
  });
  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("mode", mode);
  }, [mode]);

  const [askAnswered, setAskAnswered] = useState<Record<string, string>>({});
  const [pendingDraft, setPendingDraft] = useState<WpDraft | null>(null);
  const [toast, setToast] = useState<{ text: string; link?: string } | null>(null);
  const [publishedDrafts, setPublishedDrafts] = useState<Record<string, PublishState>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const handledDrafts = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => {});
  }, []);

  // Note: auto-publish in this branch is now handled inside EditorPane
  // (watches the editor's meta.status). The legacy wp-post fence flow is
  // deprecated — the agent emits block ops + meta_update instead. We still
  // render historical DraftCards (extractDrafts) so old sessions remain
  // readable, but we don't auto-publish them.

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
  // Block ids the agent is currently working on (e.g. user clicked "Reformuler"
  // on this paragraph or typed a prompt with a selection). Cleared when the
  // agent goes idle. Used by the editor to show a per-block shimmer while
  // the agent is processing.
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

  async function answerAsk(askKey: string, label: string, value: string) {
    if (askAnswered[askKey]) return;
    setAskAnswered((prev) => ({ ...prev, [askKey]: label }));
    await sendClick(label, value);
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary text-text-primary">
      <Header
        sessionId={sessionId}
        status={status}
        health={health}
        mode={mode}
        onModeChange={setMode}
        onNewSession={() => {
          if (
            messages.length === 0 ||
            window.confirm(
              "Démarrer une nouvelle session ? L'historique reste dans Anthropic mais l'interface part à zéro.",
            )
          ) {
            setAskAnswered({});
            handledDrafts.current = new Set();
            setPublishedDrafts({});
            // Reset editor-related state so the new session truly starts
            // empty even on the right-pane.
            setEditorOpen(false);
            setEditorSeed(null);
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

      {/* Layout: chat + editor in a flex row. The editor is ALWAYS mounted
          once a session exists (just hidden via CSS when closed) so the
          BlockNote instance keeps its state and the SSE consumer keeps
          applying agent ops in real time even while not visible.
          - md+ (>=768px, includes phones in landscape): split — chat
            shrinks to ~320-450px, editor takes the rest
          - portrait phone (<768px): chat full-width when closed, fully
            hidden when editor open (editor takes the full screen). */}
      <div className="flex-1 min-h-0 flex">
      <main
        ref={scrollRef}
        className={`
          ${editorOpen
            ? "hidden md:block md:max-w-xs lg:max-w-sm xl:max-w-md md:flex-shrink-0 md:border-r md:border-border"
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
              mode={mode}
              onPublish={(draft) => setPendingDraft(draft)}
              onAnswerAsk={(askIdx, label, value) =>
                answerAsk(`${m.id}#${askIdx}`, label, value)
              }
              askAnsweredFor={(askIdx) => askAnswered[`${m.id}#${askIdx}`]}
              publishedFor={(draftIdx) => publishedDrafts[`${m.id}#${draftIdx}`]}
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
            seedHtml={editorSeed}
            mode={mode}
            pendingAgentBlockIds={pendingAgentBlockIds}
            onClose={() => {
              setEditorOpen(false);
              setEditorSeed(null);
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

      {pendingDraft && (
        <PublishEditor
          draft={pendingDraft}
          onClose={() => setPendingDraft(null)}
          onPublished={(post) => {
            setPendingDraft(null);
            setToast({
              text: `Publié · ${pendingDraft.title?.slice(0, 50) || `#${post.id}`}`,
              link: post.link,
            });
            // Trouve la draft card pour la mettre à jour avec le lien
            for (let mi = messages.length - 1; mi >= 0; mi--) {
              const m = messages[mi];
              if (m.role !== "assistant") continue;
              const drafts = extractDrafts(assistantText(m));
              for (let di = 0; di < drafts.length; di++) {
                if (
                  drafts[di].title === pendingDraft.title &&
                  drafts[di].slug === pendingDraft.slug
                ) {
                  setPublishedDrafts((prev) => ({
                    ...prev,
                    [`${m.id}#${di}`]: { status: "published", id: post.id, link: post.link },
                  }));
                  return;
                }
              }
            }
          }}
        />
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}
