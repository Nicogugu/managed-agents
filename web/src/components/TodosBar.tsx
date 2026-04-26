import type { TodoItem } from "../types";

const PHASE_LABELS: Record<string, { emoji: string; label: string }> = {
  DISCOVER: { emoji: "🔍", label: "Discover" },
  PLAN: { emoji: "📋", label: "Plan" },
  DRAFT: { emoji: "✍", label: "Draft" },
  REVIEW: { emoji: "🔎", label: "Review" },
  PUBLISH: { emoji: "🚀", label: "Publish" },
};

export function TodosBar({
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
        <span className="text-text-muted text-sm flex-shrink-0">{open ? "▾" : "▸"}</span>
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
