import type { AskOption, WpAsk } from "../types";

/**
 * Synthetic option appended to every ask card. Lets the user offload the
 * decision to the agent ("pick whatever you think is best"). Always shown
 * first so it's the no-brainer click.
 */
const DECIDE_FOR_ME_OPTION = {
  emoji: "✨",
  label: "Décide pour moi",
  description: "Choisis l'option la plus pertinente",
  value:
    "Choisis toi-même l'option la plus pertinente parmi celles que tu viens de proposer, explique brièvement ton choix, et continue.",
};

export function AskCard({
  ask,
  onClick,
  answered,
  disabled,
}: {
  ask: WpAsk;
  onClick: (label: string, value: string, option: AskOption) => void;
  answered?: string;
  disabled: boolean;
}) {
  if (answered) {
    return (
      <div className="surface rounded-lg px-3 py-2 bg-bg-tertiary/40 border-border flex items-center gap-2 text-sm">
        <span className="text-emerald-500 flex-shrink-0">✓</span>
        {ask.question && (
          <span className="text-text-muted flex-shrink-0">{ask.question}</span>
        )}
        <span className="text-text-primary font-medium truncate">{answered}</span>
      </div>
    );
  }
  // Inject the "decide for me" shortcut at the top of the options list.
  const options = [DECIDE_FOR_ME_OPTION, ...ask.options];
  return (
    <div className="surface rounded-xl p-3 sm:p-4 bg-accent-subtle border-accent/20">
      {ask.question && (
        <div className="text-sm text-text-primary font-medium mb-3">{ask.question}</div>
      )}
      <div className="flex flex-col gap-2">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onClick(opt.label, opt.value, opt)}
            disabled={disabled}
            className="w-full text-left px-3 py-2 rounded-lg border border-border bg-bg-tertiary hover:bg-bg-elevated hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {opt.emoji && (
              <span className="text-lg flex-shrink-0 leading-none">{opt.emoji}</span>
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-text-primary font-medium truncate">
                {opt.label}
              </span>
              {opt.description && (
                <span
                  className="block text-xs text-text-tertiary mt-0.5 truncate"
                  title={opt.description}
                >
                  {opt.description}
                </span>
              )}
            </span>
            <span className="text-text-muted flex-shrink-0">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
