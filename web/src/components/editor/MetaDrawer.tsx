import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PostMeta } from "../../contract";

interface Props {
  open: boolean;
  meta: PostMeta;
  onChange: (patch: Partial<PostMeta>) => void;
  onClose: () => void;
  onLoadPost?: () => void;
  onUndoAgent?: () => void;
}

/**
 * Slide-in right-side panel for the article's secondary meta: slug,
 * excerpt, tags, SEO. Plus tertiary editor actions (load existing post,
 * undo last agent turn) that don't deserve toolbar real estate.
 */
export function MetaDrawer({
  open,
  meta,
  onChange,
  onClose,
  onLoadPost,
  onUndoAgent,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Fermer le panneau méta"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
      />
      <aside
        className="relative w-full max-w-[360px] h-full bg-bg-secondary border-l border-border shadow-elevated flex flex-col animate-[slideInRight_160ms_ease-out]"
        role="dialog"
        aria-label="Méta de l'article"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="font-medium text-sm">Méta de l'article</span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-bg-tertiary"
            aria-label="Fermer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
          <Field label="Slug">
            <input
              className="input mt-1 font-mono !text-sm"
              value={meta.slug}
              onChange={(e) => onChange({ slug: e.target.value })}
              placeholder="slug-en-kebab-case"
            />
          </Field>

          <Field label="Extrait (< 160 caractères)">
            <textarea
              className="input mt-1 min-h-[72px] resize-y !text-sm"
              value={meta.excerpt}
              onChange={(e) => onChange({ excerpt: e.target.value })}
              placeholder="Phrase d'accroche affichée sur la page d'accueil…"
            />
            <div className="text-[11px] text-text-muted mt-1 text-right">
              {meta.excerpt.length} / 160
            </div>
          </Field>

          <Field label="Tags (séparés par des virgules)">
            <input
              className="input mt-1 !text-sm"
              value={(meta.tags || []).join(", ")}
              onChange={(e) =>
                onChange({
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="ex: traefik, letsencrypt"
            />
          </Field>

          <details open className="rounded border border-border p-3 bg-bg-tertiary/40">
            <summary className="text-xs uppercase tracking-wide text-text-tertiary cursor-pointer select-none">
              SEO
            </summary>
            <div className="mt-3 space-y-2">
              <input
                className="input !text-sm"
                placeholder="Meta title (50-60 caractères)"
                value={meta.seo.title || ""}
                onChange={(e) =>
                  onChange({ seo: { ...meta.seo, title: e.target.value } })
                }
              />
              <textarea
                className="input !text-sm min-h-[60px] resize-y"
                placeholder="Meta description (140-160 caractères)"
                value={meta.seo.description || ""}
                onChange={(e) =>
                  onChange({ seo: { ...meta.seo, description: e.target.value } })
                }
              />
              <input
                className="input !text-sm"
                placeholder="Mot-clé focus"
                value={meta.seo.focus_keyword || ""}
                onChange={(e) =>
                  onChange({
                    seo: { ...meta.seo, focus_keyword: e.target.value },
                  })
                }
              />
            </div>
          </details>

          {meta.post_id && (
            <div className="text-xs text-text-muted font-mono">
              post_id #{meta.post_id}
            </div>
          )}
        </div>

        {(onLoadPost || onUndoAgent) && (
          <div className="border-t border-border p-3 flex flex-col gap-1.5 text-xs flex-shrink-0">
            {onLoadPost && (
              <button
                type="button"
                onClick={onLoadPost}
                className="btn-ghost text-left !py-1.5"
                title="Charger un article WP existant pour le modifier"
              >
                ↧ Charger un article WP par ID
              </button>
            )}
            {onUndoAgent && (
              <button
                type="button"
                onClick={onUndoAgent}
                className="btn-ghost text-left !py-1.5"
                title="Annule le dernier turn de l'agent"
              >
                ↶ Annuler le dernier turn agent
              </button>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
