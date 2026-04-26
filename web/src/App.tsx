import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./useSession";
import { sendMessage, publishDraft, fetchHealth } from "./api";
import { extractDrafts, stripDraftFences } from "./parseDraft";
import { PublishModal } from "./PublishModal";
import type { ChatMessage, Mode, WpDraft } from "./types";

type Health = { ok: boolean; anthropicKey: boolean; wpConfigured: boolean };

export function App() {
  const { sessionId, messages, status, error, appendUserMessage } = useSession();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("validate");
  const [pendingDraft, setPendingDraft] = useState<WpDraft | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const handledDrafts = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => {});
  }, []);

  // Auto-publish on new drafts when in auto mode
  useEffect(() => {
    if (mode !== "auto") return;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const drafts = extractDrafts(m.text);
      for (let i = 0; i < drafts.length; i++) {
        const key = `${m.id}#${i}`;
        if (handledDrafts.current.has(key)) continue;
        handledDrafts.current.add(key);
        publishDraft(drafts[i])
          .then((post) =>
            setToast(
              `${drafts[i].action === "create" ? "Créé" : "Mis à jour"} · ${post.link || `#${post.id}`}`,
            ),
          )
          .catch((err) => setToast(`Erreur · ${err.message}`));
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

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  async function handleSend() {
    if (!sessionId || !input.trim() || status === "running") return;
    const text = input.trim();
    appendUserMessage(text);
    setInput("");
    try {
      await sendMessage(sessionId, text);
    } catch (err: any) {
      setToast(`Erreur · ${err.message}`);
    }
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary text-text-primary">
      <Header
        sessionId={sessionId}
        status={status}
        health={health}
        mode={mode}
        onModeChange={setMode}
      />

      <main ref={scrollRef} className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-3">
          {error && (
            <div className="surface border-red-500/40 bg-red-500/10 text-red-300 text-sm rounded-md p-3">
              {error}
            </div>
          )}
          {health && !health.anthropicKey && (
            <div className="surface bg-amber-500/5 border-amber-500/30 text-amber-200 text-sm rounded-md p-3">
              <span className="font-medium">ANTHROPIC_API_KEY manquante</span> · ajoute-la dans <code className="font-mono text-xs">server/.env</code>
            </div>
          )}
          {messages.length === 0 && !error && (
            <EmptyState />
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mode={mode}
              onPublish={(draft) => setPendingDraft(draft)}
            />
          ))}
          {status === "running" && <Thinking />}
        </div>
      </main>

      <footer className="border-t border-border bg-bg-primary">
        <div className="max-w-3xl mx-auto p-3 sm:p-4">
          <div className="surface rounded-xl flex items-end gap-2 p-2 focus-within:border-border-strong transition-colors">
            <textarea
              ref={textareaRef}
              className="flex-1 bg-transparent border-0 resize-none px-2 py-1.5 text-md placeholder:text-text-muted focus:outline-none min-h-[24px] max-h-[200px]"
              placeholder="Écrire à l'agent…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!sessionId || status === "running"}
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!sessionId || !input.trim() || status === "running"}
              className="btn-primary self-end"
              aria-label="Envoyer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l10-4-3 10-2-4-5-2z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div className="mt-2 px-1 flex items-center justify-between text-xs text-text-muted">
            <span>Entrée pour envoyer · Shift+Entrée pour saut de ligne</span>
            <span className="hidden sm:inline">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </footer>

      {pendingDraft && (
        <PublishModal
          draft={pendingDraft}
          onClose={() => setPendingDraft(null)}
          onPublished={(post) => {
            setPendingDraft(null);
            setToast(`Publié · ${post.link || `#${post.id}`}`);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 surface rounded-lg shadow-elevated text-sm px-4 py-2.5 max-w-sm animate-[fadeIn_120ms_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}

function Header({
  sessionId,
  status,
  health,
  mode,
  onModeChange,
}: {
  sessionId: string | null;
  status: "idle" | "running" | "connecting";
  health: Health | null;
  mode: Mode;
  onModeChange: (m: Mode) => void;
}) {
  return (
    <header className="border-b border-border bg-bg-primary/80 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-12">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-accent text-[10px] font-bold">W</span>
          </div>
          <h1 className="text-md font-semibold tracking-tight truncate">WP Editor</h1>
          <StatusDot status={status} />
          {health && !health.anthropicKey && (
            <span className="pill !text-amber-300 !border-amber-500/40 !bg-amber-500/10 hidden sm:inline-flex">
              no key
            </span>
          )}
        </div>
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>
      {sessionId && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-2 text-xs text-text-muted font-mono truncate">
          {sessionId}
        </div>
      )}
    </header>
  );
}

function StatusDot({ status }: { status: "idle" | "running" | "connecting" }) {
  const config = {
    idle: { color: "bg-emerald-500", label: "ready", glow: "shadow-[0_0_8px_rgba(16,185,129,0.6)]" },
    running: { color: "bg-amber-500", label: "thinking", glow: "shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" },
    connecting: { color: "bg-text-muted", label: "connecting", glow: "" },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
      <span className={`w-1.5 h-1.5 rounded-full ${config.color} ${config.glow}`} />
      <span className="hidden sm:inline">{config.label}</span>
    </span>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex bg-bg-tertiary border border-border rounded-md p-0.5 text-xs">
      <button
        onClick={() => onChange("validate")}
        className={`px-2 sm:px-3 py-1 rounded transition-colors ${
          mode === "validate"
            ? "bg-bg-elevated text-text-primary shadow-sm"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        Validation
      </button>
      <button
        onClick={() => onChange("auto")}
        className={`px-2 sm:px-3 py-1 rounded transition-colors ${
          mode === "auto"
            ? "bg-bg-elevated text-text-primary shadow-sm"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        Auto-publish
      </button>
    </div>
  );
}

function EmptyState() {
  const examples = [
    "Rédige un article SEO de 500 mots sur le café de spécialité",
    "Mets à jour l'article #12 en ajoutant un paragraphe sur l'arabica",
    "Liste mes 5 derniers articles WordPress",
  ];
  return (
    <div className="text-center py-12 sm:py-20">
      <div className="text-text-secondary text-md mb-2">Demande à l'agent</div>
      <div className="text-text-muted text-sm mb-6">
        de rédiger, mettre à jour, ou rechercher avant publication
      </div>
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        {examples.map((ex) => (
          <div key={ex} className="surface rounded-md px-3 py-2 text-sm text-text-secondary text-left">
            <span className="text-text-muted mr-2">›</span>
            {ex}
          </div>
        ))}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted px-1 py-1">
      <div className="flex gap-1">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="w-1 h-1 rounded-full bg-text-muted animate-pulse"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
      <span>l'agent travaille…</span>
    </div>
  );
}

function MessageBubble({
  message,
  mode,
  onPublish,
}: {
  message: ChatMessage;
  mode: Mode;
  onPublish: (draft: WpDraft) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-accent/15 border border-accent/30 text-text-primary rounded-2xl rounded-br-md px-3.5 py-2 max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap text-md">
          {message.text}
        </div>
      </div>
    );
  }

  const drafts = useMemo(() => extractDrafts(message.text), [message.text]);
  const visibleText = useMemo(() => stripDraftFences(message.text), [message.text]);

  return (
    <div className="flex flex-col gap-2 max-w-[92%] sm:max-w-[85%]">
      {message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.toolCalls.map((t, i) => (
            <ToolCallRow key={i} call={t} />
          ))}
        </div>
      )}

      {visibleText && (
        <div className="surface rounded-2xl rounded-bl-md px-3.5 py-2.5 whitespace-pre-wrap text-md leading-relaxed text-text-primary">
          {visibleText}
        </div>
      )}

      {drafts.map((draft, i) => (
        <DraftCard
          key={i}
          draft={draft}
          mode={mode}
          onPublish={() => onPublish(draft)}
        />
      ))}
    </div>
  );
}

function ToolIcon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    bash: "›_",
    read: "📄",
    write: "✎",
    edit: "✎",
    glob: "*",
    grep: "⌕",
    web_search: "⌕",
    web_fetch: "↓",
  };
  return <span className="font-mono text-[10px] mr-0.5 opacity-70">{icons[name] || "•"}</span>;
}

function summarizeTool(call: { name: string; input?: Record<string, any> }): string {
  const i = call.input || {};
  switch (call.name) {
    case "bash":
      return i.command || "";
    case "web_fetch":
      return i.url || "";
    case "web_search":
      return i.query || "";
    case "read":
    case "write":
    case "edit":
      return i.path || i.file_path || "";
    case "glob":
      return i.pattern || "";
    case "grep":
      return [i.pattern, i.path].filter(Boolean).join("  in  ");
    default:
      // Generic: take first scalar value
      const val = Object.values(i).find(
        (v) => typeof v === "string" || typeof v === "number",
      );
      return val ? String(val) : "";
  }
}

function ToolCallRow({
  call,
}: {
  call: { name: string; status: "running" | "done"; input?: Record<string, any> };
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeTool(call);
  const hasInput = call.input && Object.keys(call.input).length > 0;
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => hasInput && setOpen((o) => !o)}
        className={`flex items-start gap-2 w-full text-left px-2 py-1 rounded-md border transition-colors ${
          call.status === "running"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-bg-tertiary/40 hover:bg-bg-tertiary"
        }`}
      >
        <span className="flex items-center gap-1 flex-shrink-0">
          <ToolIcon name={call.name} />
          <span className="font-mono text-text-secondary">{call.name}</span>
          {call.status === "running" ? (
            <span className="text-amber-400 animate-pulse">…</span>
          ) : (
            <span className="text-emerald-500">✓</span>
          )}
        </span>
        {summary && (
          <span className="font-mono text-text-tertiary truncate flex-1 min-w-0">
            {summary}
          </span>
        )}
        {hasInput && (
          <span className="text-text-muted flex-shrink-0">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && hasInput && (
        <pre className="mt-1 ml-4 p-2 rounded-md bg-bg-primary border border-border text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto">
          {JSON.stringify(call.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  mode,
  onPublish,
}: {
  draft: WpDraft;
  mode: Mode;
  onPublish: () => void;
}) {
  return (
    <div className="surface rounded-xl p-3 sm:p-4 border-accent/20 bg-accent-subtle">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="pill pill-running !text-accent !bg-accent-subtle !border-accent/40 uppercase tracking-wide">
              {draft.action === "create" ? "nouveau" : `update #${draft.id}`}
            </span>
            {draft.status && (
              <span className="pill text-text-tertiary uppercase tracking-wide">{draft.status}</span>
            )}
          </div>
          <div className="font-semibold text-text-primary text-md truncate">
            {draft.title || "(sans titre)"}
          </div>
          {draft.excerpt && (
            <div className="text-sm text-text-secondary mt-1 line-clamp-2">
              {draft.excerpt}
            </div>
          )}
        </div>
        {mode === "validate" ? (
          <button onClick={onPublish} className="btn-primary flex-shrink-0">
            Publier
          </button>
        ) : (
          <span className="text-xs text-text-tertiary self-center flex-shrink-0">auto…</span>
        )}
      </div>
      <details className="mt-2">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-tertiary select-none">
          JSON brut
        </summary>
        <pre className="text-xs bg-bg-primary border border-border rounded-md p-2 mt-1.5 overflow-auto max-h-60 text-text-secondary font-mono">
          {JSON.stringify(draft, null, 2)}
        </pre>
      </details>
    </div>
  );
}
