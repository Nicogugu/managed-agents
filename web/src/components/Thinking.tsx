export function Thinking({
  activity,
  silenceSec,
}: {
  activity: { icon: string; text: string; mono?: boolean } | null;
  silenceSec: number;
}) {
  return (
    <div className="flex items-start gap-2 text-xs text-text-muted px-1 py-2">
      <div className="flex gap-1 mt-1.5 flex-shrink-0">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="w-1 h-1 rounded-full bg-text-muted animate-pulse"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-text-muted">
          <span>l'agent travaille…</span>
          {silenceSec >= 3 && (
            <span
              className={`tabular-nums ${
                silenceSec >= 30 ? "text-amber-400" : "text-text-muted"
              }`}
            >
              {silenceSec}s
            </span>
          )}
        </div>
        {activity && (
          <div className="mt-0.5 flex items-center gap-1.5 text-text-secondary overflow-hidden whitespace-nowrap">
            <span className="flex-shrink-0 animate-pulse">{activity.icon}</span>
            <span className={`truncate ${activity.mono ? "font-mono text-[11px]" : ""}`}>
              {activity.text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
