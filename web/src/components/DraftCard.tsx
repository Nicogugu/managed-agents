import type { Mode, PublishState, WpDraft } from "../types";

export function DraftCard({
  draft,
  mode,
  onPublish,
  published,
}: {
  draft: WpDraft;
  mode: Mode;
  onPublish: () => void;
  published?: PublishState;
}) {
  const isPublished = published?.status === "published";
  const isPending = published?.status === "pending";
  const isError = published?.status === "error";

  const titleEl =
    isPublished && published.status === "published" ? (
      <a
        href={published.link}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-accent text-md truncate hover:underline inline-flex items-center gap-1"
      >
        {draft.title || "(sans titre)"}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <path d="M14 3h7v7" />
          <path d="M10 14L21 3" />
          <path d="M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6" />
        </svg>
      </a>
    ) : (
      <div className="font-semibold text-text-primary text-md truncate">
        {draft.title || "(sans titre)"}
      </div>
    );

  return (
    <div className="surface rounded-xl p-3 sm:p-4 border-accent/20 bg-accent-subtle">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="pill pill-running !text-accent !bg-accent-subtle !border-accent/40 uppercase tracking-wide">
              {draft.action === "create" ? "nouveau" : `update #${draft.id}`}
            </span>
            {isPending && (
              <span className="pill !text-amber-300 !border-amber-500/40 !bg-amber-500/10 uppercase tracking-wide">
                <span className="animate-pulse">📤</span> publication…
              </span>
            )}
            {isPublished && published.status === "published" && (
              <span className="pill !text-emerald-400 !border-emerald-500/40 !bg-emerald-500/10 uppercase tracking-wide">
                ✓ publié #{published.id}
              </span>
            )}
            {isError && (
              <span className="pill !text-red-400 !border-red-500/40 !bg-red-500/10 uppercase tracking-wide">
                ⚠ erreur
              </span>
            )}
            {!published && draft.status && (
              <span className="pill text-text-tertiary uppercase tracking-wide">{draft.status}</span>
            )}
          </div>
          {titleEl}
          {draft.excerpt && (
            <div className="text-sm text-text-secondary mt-1 line-clamp-2">
              {draft.excerpt}
            </div>
          )}
          {isPublished && published.status === "published" && (
            <a
              href={published.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-accent hover:underline mt-2 truncate font-mono"
            >
              {published.link}
            </a>
          )}
          {isError && published.status === "error" && (
            <div className="text-xs text-red-400 mt-2">{published.error}</div>
          )}
        </div>
        {!published && mode === "validate" && (
          <button onClick={onPublish} className="btn-primary flex-shrink-0">
            Publier
          </button>
        )}
        {!published && mode === "auto" && (
          <span className="text-xs text-text-tertiary self-center flex-shrink-0">auto…</span>
        )}
        {isError && (
          <button onClick={onPublish} className="btn-secondary flex-shrink-0 text-xs">
            Réessayer
          </button>
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
