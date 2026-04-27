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

  // Auto-publish on new drafts when in auto mode
  useEffect(() => {
    if (mode !== "auto") return;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const drafts = extractDrafts(assistantText(m));
      for (let i = 0; i < drafts.length; i++) {
        const key = `${m.id}#${i}`;
        if (handledDrafts.current.has(key)) continue;
        handledDrafts.current.add(key);
        const isUpdate = drafts[i].action === "update";
        setPublishedDrafts((prev) => ({ ...prev, [key]: { status: "pending" } }));
        publishDraft({ ...drafts[i], status: "publish" })
          .then((post: any) => {
            setPublishedDrafts((prev) => ({
              ...prev,
              [key]: { status: "published", id: post.id, link: post.link },
            }));
            setToast({
              text: `${isUpdate ? "Mis à jour" : "Publié"} · ${
                drafts[i].title?.slice(0, 50) || `#${post.id}`
              }`,
              link: post.link,
            });
          })
          .catch((err) => {
            setPublishedDrafts((prev) => ({
              ...prev,
              [key]: { status: "error", error: err.message },
            }));
            setToast({ text: `Erreur · ${err.message}` });
          });
      }
    }
  }, [messages, mode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ------- Send handlers ----------------------------------------------------
  async function sendText(text: string) {
    if (!sessionId) return;
    appendUserMessage(text);
    try {
      await sendMessage(sessionId, text);
    } catch (err: any) {
      setToast({ text: `Erreur · ${err.message}` });
    }
  }

  async function sendClick(label: string, value: string) {
    if (!sessionId) return;
    appendUserMessage(label);
    try {
      await sendMessage(sessionId, value);
    } catch (err: any) {
      setToast({ text: `Erreur · ${err.message}` });
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

      {/* Layout: chat scrolls. On lg+, when editor is open it shares the
          horizontal axis. On mobile, the editor renders as a full-screen
          overlay below so we don't squeeze the chat (which the user is still
          actively reading). */}
      <div className={`flex-1 min-h-0 flex ${editorOpen ? "lg:flex-row" : ""}`}>
      <main
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-auto ${
          editorOpen ? "lg:max-w-md xl:max-w-lg lg:flex-shrink-0 lg:border-r lg:border-border" : ""
        }`}
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

      {editorOpen && (
        <section
          className="
            hidden lg:flex flex-1 min-h-0 min-w-0 border-l border-border
            lg:relative
          "
        >
          <EditorPane
            sessionId={sessionId}
            seedHtml={editorSeed}
            onClose={() => {
              setEditorOpen(false);
              setEditorSeed(null);
              draftAuto.reset();
            }}
            onPublished={(p) => {
              setToast({
                text: `Publié · #${p.id}`,
                link: p.link,
              });
            }}
            onToast={(t) => setToast({ text: t })}
          />
        </section>
      )}
      </div>

      {/* Mobile: full-screen overlay editor (below lg) */}
      {editorOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col bg-bg-primary">
          <EditorPane
            sessionId={sessionId}
            seedHtml={editorSeed}
            onClose={() => {
              setEditorOpen(false);
              setEditorSeed(null);
              draftAuto.reset();
            }}
            onPublished={(p) => {
              setToast({
                text: `Publié · #${p.id}`,
                link: p.link,
              });
            }}
            onToast={(t) => setToast({ text: t })}
          />
        </div>
      )}

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
