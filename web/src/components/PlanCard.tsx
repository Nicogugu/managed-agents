import type { WpPlan } from "../types";

export function PlanCard({
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
