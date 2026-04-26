import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./useSession";
import { sendMessage, publishDraft, fetchHealth } from "./api";
import {
  extractAsks,
  extractDrafts,
  extractPlans,
  extractTodos,
  stripBlocks,
} from "./parseDraft";
import { PublishModal } from "./PublishModal";
import type { ChatMessage, Mode, TodoItem, WpAsk, WpDraft, WpPlan } from "./types";

type Health = { ok: boolean; anthropicKey: boolean; wpConfigured: boolean };

export function App() {
  const { sessionId, messages, status, error, appendUserMessage } = useSession();
  const [input, setInput] = useState("");
  const [todosOpen, setTodosOpen] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  // Todos courantes = dernier checklist non-vide trouvé dans un message assistant
  const todos = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const t = extractTodos(m.text);
      if (t.length > 0) return t;
    }
    return [];
  }, [messages]);
  // Activité courante de l'agent (ce qu'il fait MAINTENANT) — pour la live status line
  const activity = useMemo(() => {
    if (status === "idle") return null;
    if (status === "connecting") return { icon: "⏳", text: "Connexion au stream…" };

    // Cherche le dernier outil running dans le dernier message assistant
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const running = [...m.toolCalls].reverse().find((t) => t.status === "running");
      if (running) {
        return {
          icon: toolIconChar(running.name),
          text: `${running.name}${summarizeToolForLine(running) ? " · " + summarizeToolForLine(running) : ""}`,
          mono: true,
        };
      }
      // Si tous les outils sont done mais l'agent stream du texte → "rédaction"
      if (m.toolCalls.length > 0 && m.text) {
        return { icon: "✍", text: "Rédaction…" };
      }
      break;
    }
    return { icon: "✻", text: "Réflexion…" };
  }, [messages, status]);

  const currentPhase = useMemo(() => {
    // Cherche la dernière phase déclarée par l'agent ("Phase: DISCOVER", "📋 Phase: PLAN"...)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      // Tolère le markdown bold autour du nom de phase: "Phase: **PLAN**" ou "Phase: PLAN"
      const match = m.text.match(/Phase\s*:?\s*\*{0,2}\s*(DISCOVER|PLAN|DRAFT|REVIEW|PUBLISH)\s*\*{0,2}/i);
      if (match) return match[1].toUpperCase();
    }
    return null;
  }, [messages]);
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

  async function sendClick(label: string, value: string) {
    if (!sessionId || status === "running") return;
    appendUserMessage(label);
    try {
      await sendMessage(sessionId, value);
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

      {(todos.length > 0 || currentPhase) && (
        <TodosBar
          todos={todos}
          phase={currentPhase}
          open={todosOpen}
          onToggle={() => setTodosOpen((o) => !o)}
        />
      )}

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
            <EmptyState onPick={sendClick} disabled={!sessionId || status === "running"} />
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mode={mode}
              onPublish={(draft) => setPendingDraft(draft)}
              onClickAsk={sendClick}
              onApprovePlan={() => sendClick("✓ vasy", "vasy")}
              disabled={status === "running"}
            />
          ))}
          {status === "running" && <Thinking />}
        </div>
      </main>

      {activity && (
        <div className="border-t border-border bg-bg-elevated px-4 sm:px-6 py-2 flex items-center gap-2 text-sm text-text-secondary">
          <span className="animate-pulse flex-shrink-0">{activity.icon}</span>
          <span
            className={`truncate min-w-0 ${activity.mono ? "font-mono text-xs" : ""}`}
          >
            {activity.text}
          </span>
        </div>
      )}

      <footer className="border-t border-border bg-bg-primary">
        <div className="max-w-3xl mx-auto p-3 sm:p-4">
          {textInputOpen ? (
            <>
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
                  autoFocus
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
                <button
                  type="button"
                  onClick={() => {
                    setTextInputOpen(false);
                    setInput("");
                  }}
                  className="hover:text-text-tertiary"
                >
                  ← Mode boutons
                </button>
                <span className="hidden sm:inline">
                  Entrée pour envoyer · Shift+Entrée pour saut de ligne
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between text-xs text-text-muted px-1">
              <span>
                {status === "running"
                  ? "L'agent travaille…"
                  : "Clique une option ci-dessus"}
              </span>
              <button
                type="button"
                onClick={() => setTextInputOpen(true)}
                className="hover:text-text-tertiary underline"
              >
                ✎ Écrire
              </button>
            </div>
          )}
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
      <span>{config.label}</span>
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

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (label: string, value: string) => void;
  disabled: boolean;
}) {
  const starters: Array<{ emoji: string; label: string; description: string; value: string }> = [
    {
      emoji: "💡",
      label: "Propose-moi 5 idées d'articles",
      description: "L'agent regarde l'existant et te suggère des angles complémentaires",
      value:
        "Phase DISCOVER : regarde les articles WordPress existants et propose-moi 5 idées d'articles qui complètent (pas dupliquent) le contenu actuel. Émets un bloc ```ask``` avec les 5 options pour que je clique celle que je préfère.",
    },
    {
      emoji: "✍",
      label: "Rédige un article complet maintenant",
      description: "L'agent demande le sujet via boutons et lance le pipeline",
      value:
        "Je veux un nouvel article. Émets un bloc ```ask``` pour me demander le format/longueur et la thématique parmi des choix cliquables.",
    },
    {
      emoji: "🔄",
      label: "Mets à jour un article existant",
      description: "L'agent liste les articles cliquables",
      value:
        "Je veux mettre à jour un article existant. Liste les 10 articles les plus récents via /api/wp/posts et émets un bloc ```ask``` avec les options cliquables.",
    },
    {
      emoji: "🎨",
      label: "Génère juste une image",
      description: "Sans article, juste une image dans WP Media",
      value:
        "Je veux générer une image (sans article). Émets un bloc ```ask``` pour me demander le sujet/style parmi des choix.",
    },
  ];
  return (
    <div className="py-6 sm:py-10">
      <div className="text-center mb-6">
        <div className="text-text-secondary text-md mb-1">Article Code</div>
        <div className="text-text-muted text-sm">
          Clique pour démarrer — l'agent te guide en mode boutons.
        </div>
      </div>
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        {starters.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.label, s.value)}
            disabled={disabled}
            className="surface rounded-lg px-4 py-3 text-left hover:bg-bg-tertiary hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-start gap-3"
          >
            <span className="text-xl flex-shrink-0 leading-none mt-0.5">{s.emoji}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-text-primary font-medium">{s.label}</span>
              <span className="block text-xs text-text-tertiary mt-0.5">{s.description}</span>
            </span>
          </button>
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
  onClickAsk,
  onApprovePlan,
  disabled,
}: {
  message: ChatMessage;
  mode: Mode;
  onPublish: (draft: WpDraft) => void;
  onClickAsk: (label: string, value: string) => void;
  onApprovePlan: () => void;
  disabled: boolean;
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
  const plans = useMemo(() => extractPlans(message.text), [message.text]);
  const asks = useMemo(() => extractAsks(message.text), [message.text]);
  const visibleText = useMemo(() => stripBlocks(message.text), [message.text]);

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

      {plans.map((plan, i) => (
        <PlanCard key={`plan-${i}`} plan={plan} onApprove={onApprovePlan} disabled={disabled} />
      ))}

      {drafts.map((draft, i) => (
        <DraftCard
          key={i}
          draft={draft}
          mode={mode}
          onPublish={() => onPublish(draft)}
        />
      ))}

      {asks.map((ask, i) => (
        <AskCard key={`ask-${i}`} ask={ask} onClick={onClickAsk} disabled={disabled} />
      ))}
    </div>
  );
}

function AskCard({
  ask,
  onClick,
  disabled,
}: {
  ask: WpAsk;
  onClick: (label: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="surface rounded-xl p-3 sm:p-4 bg-accent-subtle border-accent/20">
      {ask.question && (
        <div className="text-sm text-text-primary font-medium mb-3">{ask.question}</div>
      )}
      <div className="flex flex-col gap-2">
        {ask.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onClick(opt.label, opt.value)}
            disabled={disabled}
            className="w-full text-left px-3 py-2 rounded-lg border border-border bg-bg-tertiary hover:bg-bg-elevated hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-start gap-2"
          >
            {opt.emoji && (
              <span className="text-lg flex-shrink-0 leading-none mt-0.5">{opt.emoji}</span>
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-text-primary font-medium">{opt.label}</span>
              {opt.description && (
                <span className="block text-xs text-text-tertiary mt-0.5">{opt.description}</span>
              )}
            </span>
            <span className="text-text-muted flex-shrink-0">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onApprove,
  disabled,
}: {
  plan: WpPlan;
  onApprove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="surface rounded-xl p-3 sm:p-4 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-2">
        <span className="pill !text-amber-300 !border-amber-500/40 !bg-amber-500/10 uppercase tracking-wide">
          📋 brief
        </span>
        {plan.wordCount && (
          <span className="pill text-text-tertiary">~{plan.wordCount} mots</span>
        )}
      </div>
      {plan.title && (
        <div className="font-semibold text-text-primary text-md mb-1">{plan.title}</div>
      )}
      {plan.slug && (
        <div className="text-xs font-mono text-text-muted mb-2">/{plan.slug}</div>
      )}
      {plan.outline && plan.outline.length > 0 && (
        <ul className="text-sm text-text-secondary list-disc list-inside space-y-0.5 mb-2">
          {plan.outline.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1 mb-2">
        {plan.category && (
          <span className="pill text-text-tertiary">📁 {plan.category}</span>
        )}
        {(plan.tags || []).map((t) => (
          <span key={t} className="pill text-text-tertiary">#{t}</span>
        ))}
      </div>
      {plan.image?.needed && plan.image.prompt && (
        <div className="text-xs text-text-tertiary mt-2 border-t border-border pt-2">
          🎨 <span className="font-mono">{plan.image.prompt}</span>
        </div>
      )}
      {plan.sources && plan.sources.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="text-text-muted cursor-pointer">{plan.sources.length} source(s)</summary>
          <ul className="mt-1 space-y-0.5 text-text-tertiary">
            {plan.sources.map((s, i) => (
              <li key={i} className="truncate">
                <a href={s} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="btn-primary"
        >
          ✓ Approuver et drafter
        </button>
      </div>
    </div>
  );
}

const PHASE_LABELS: Record<string, { emoji: string; label: string }> = {
  DISCOVER: { emoji: "🔍", label: "Discover" },
  PLAN: { emoji: "📋", label: "Plan" },
  DRAFT: { emoji: "✍", label: "Draft" },
  REVIEW: { emoji: "🔎", label: "Review" },
  PUBLISH: { emoji: "🚀", label: "Publish" },
};

function TodosBar({
  todos,
  phase,
  open,
  onToggle,
}: {
  todos: TodoItem[];
  phase: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const done = todos.filter((t) => t.status === "done").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const pct = todos.length === 0 ? 0 : (done / todos.length) * 100;
  const phaseInfo = phase ? PHASE_LABELS[phase] : null;

  return (
    <div className="border-b border-border bg-bg-elevated">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 sm:px-6 py-2 text-left hover:bg-bg-tertiary transition-colors"
      >
        {phaseInfo && (
          <span className="flex items-center gap-1 text-sm font-medium text-text-primary flex-shrink-0">
            <span>{phaseInfo.emoji}</span>
            <span>{phaseInfo.label}</span>
          </span>
        )}
        {todos.length > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span className="flex-1 min-w-0">
              {inProgress ? (
                <span className="text-xs text-text-secondary truncate inline-block max-w-full align-middle">
                  <span className="text-amber-400 mr-1 animate-pulse">▸</span>
                  {inProgress.text}
                </span>
              ) : (
                <span className="text-xs text-text-muted">
                  {done === todos.length ? "tout terminé" : "en attente"}
                </span>
              )}
            </span>
            <span className="text-xs text-text-tertiary flex-shrink-0 font-mono tabular-nums">
              {done}/{todos.length}
            </span>
          </>
        )}
        <span className="text-text-muted text-sm flex-shrink-0">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {todos.length > 0 && (
        <div
          className="h-0.5 bg-emerald-500/70 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      )}

      {open && todos.length > 0 && (
        <ul className="px-4 sm:px-6 py-2 space-y-1 border-t border-border max-h-[50vh] overflow-auto">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 flex-shrink-0 w-4 text-center">
                {t.status === "done" ? (
                  <span className="text-emerald-500">✓</span>
                ) : t.status === "in_progress" ? (
                  <span className="text-amber-400 animate-pulse">▸</span>
                ) : (
                  <span className="text-text-muted">○</span>
                )}
              </span>
              <span
                className={
                  t.status === "done"
                    ? "text-text-muted line-through"
                    : t.status === "in_progress"
                    ? "text-text-primary font-medium"
                    : "text-text-secondary"
                }
              >
                {t.text}
              </span>
            </li>
          ))}
        </ul>
      )}
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

function toolIconChar(name: string): string {
  return (
    {
      bash: "›_",
      read: "📄",
      write: "✎",
      edit: "✎",
      glob: "*",
      grep: "⌕",
      web_search: "⌕",
      web_fetch: "↓",
    } as Record<string, string>
  )[name] || "🔧";
}

function summarizeToolForLine(call: { name: string; input?: Record<string, any> }): string {
  const i = call.input || {};
  const raw = (() => {
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
      case "grep":
        return i.pattern || "";
      default: {
        const v = Object.values(i).find(
          (x) => typeof x === "string" || typeof x === "number",
        );
        return v ? String(v) : "";
      }
    }
  })();
  // Tronque agressivement pour la ligne unique
  return raw.replace(/\s+/g, " ").slice(0, 90);
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
