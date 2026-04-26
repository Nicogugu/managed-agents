import { useEffect, useState } from "react";
import type { WpDraft } from "./types";
import { publishDraft } from "./api";

type Props = {
  draft: WpDraft;
  onClose: () => void;
  onPublished: (post: any) => void;
};

export function PublishModal({ draft, onClose, onPublished }: Props) {
  const [edited, setEdited] = useState<WpDraft>(draft);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update<K extends keyof WpDraft>(key: K, value: WpDraft[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const post = await publishDraft(edited);
      onPublished(post);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_120ms_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="surface rounded-xl shadow-elevated w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-md tracking-tight">
            {edited.action === "create" ? "Nouvel article WordPress" : `Mettre à jour #${edited.id}`}
          </h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors"
            aria-label="Fermer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-auto px-4 sm:px-5 py-4 space-y-3">
          <Field label="Titre">
            <input
              className="input"
              value={edited.title || ""}
              onChange={(e) => update("title", e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Slug">
            <input
              className="input font-mono text-sm"
              value={edited.slug || ""}
              onChange={(e) => update("slug", e.target.value)}
              placeholder="auto-generated-from-title"
            />
          </Field>

          <Field label="Extrait">
            <textarea
              className="input min-h-[60px] resize-y"
              value={edited.excerpt || ""}
              onChange={(e) => update("excerpt", e.target.value)}
            />
          </Field>

          <Field label="Contenu HTML">
            <textarea
              className="input min-h-[260px] font-mono text-sm resize-y"
              value={edited.content || ""}
              onChange={(e) => update("content", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Statut">
              <select
                className="input"
                value={edited.status || "draft"}
                onChange={(e) => update("status", e.target.value as WpDraft["status"])}
              >
                <option value="draft">draft</option>
                <option value="publish">publish</option>
                <option value="pending">pending</option>
                <option value="private">private</option>
              </select>
            </Field>
            <Field label="Tags (virgules)">
              <input
                className="input"
                value={(edited.tags || []).join(", ")}
                onChange={(e) =>
                  update(
                    "tags",
                    e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md p-3">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-bg-primary">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={handlePublish} disabled={publishing} className="btn-primary">
            {publishing
              ? "Envoi…"
              : edited.action === "create"
                ? "Créer dans WP"
                : "Mettre à jour"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
