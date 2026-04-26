import type { Mode } from "../types";

type Health = { ok: boolean; anthropicKey: boolean; wpConfigured: boolean };
type Status = "idle" | "running" | "connecting";

export function Header({
  sessionId,
  status,
  health,
  mode,
  onModeChange,
  onNewSession,
}: {
  sessionId: string | null;
  status: Status;
  health: Health | null;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onNewSession: () => void;
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted font-mono truncate">{sessionId}</span>
          <button
            type="button"
            onClick={onNewSession}
            className="text-xs text-text-muted hover:text-text-secondary underline flex-shrink-0"
          >
            ＋ nouvelle session
          </button>
        </div>
      )}
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
