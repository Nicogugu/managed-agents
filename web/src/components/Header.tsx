type Health = { ok: boolean; anthropicKey: boolean; wpConfigured: boolean };
type Status = "idle" | "running" | "connecting";

export function Header({
  sessionId,
  status,
  health,
  stalled,
  onNewSession,
  onReconnect,
  onOpenMeta,
  metaActive,
  onPublish,
  publishLabel,
  publishDisabled,
}: {
  sessionId: string | null;
  status: Status;
  health: Health | null;
  stalled?: boolean;
  onNewSession: () => void;
  onReconnect?: () => void;
  onOpenMeta?: () => void;
  metaActive?: boolean;
  onPublish?: () => void;
  publishLabel?: string;
  publishDisabled?: boolean;
}) {
  return (
    <header className="border-b border-border bg-bg-primary/80 backdrop-blur-md sticky top-0 z-10">
      <div className="mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-12 max-w-[1400px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-accent text-[10px] font-bold">W</span>
          </div>
          <h1 className="text-md font-semibold tracking-tight truncate">WP Editor</h1>
          {stalled && onReconnect ? (
            <button
              type="button"
              onClick={onReconnect}
              className="inline-flex items-center gap-1.5 text-xs text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded-md px-2 py-0.5 hover:bg-amber-500/20"
              title="L'agent ne répond plus depuis 20 s — relance le stream"
            >
              ⚠ Reconnecter
            </button>
          ) : (
            <StatusDot status={status} />
          )}
          {health && !health.anthropicKey && (
            <span className="pill !text-amber-300 !border-amber-500/40 !bg-amber-500/10 hidden sm:inline-flex">
              no key
            </span>
          )}
          {sessionId && (
            <span className="text-[11px] text-text-muted font-mono truncate hidden md:inline ml-2">
              {sessionId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sessionId && (
            <button
              type="button"
              onClick={onNewSession}
              className="text-xs text-text-muted hover:text-text-primary border border-transparent hover:border-border rounded-md px-2 py-1"
              title="Démarrer une nouvelle session"
            >
              ＋ Nouvelle
            </button>
          )}
          {onOpenMeta && (
            <button
              type="button"
              onClick={onOpenMeta}
              className={`text-xs rounded-md px-2 py-1 border ${
                metaActive
                  ? "border-accent/40 text-accent bg-accent/10"
                  : "border-border text-text-tertiary hover:text-text-primary"
              }`}
              title="Slug, extrait, catégories, tags, SEO"
            >
              ⚙ Méta
            </button>
          )}
          {onPublish && (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishDisabled}
              className="btn-primary !py-1 !px-3 text-xs"
            >
              {publishLabel || "Publier"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function StatusDot({ status }: { status: Status }) {
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
