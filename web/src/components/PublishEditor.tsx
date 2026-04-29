import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./BlockEditor.css";

import { editorSchema } from "./editor/blockEditorSchema";
import type { WpDraft } from "../types";
import { publishDraft } from "../api";

type Props = {
  draft: WpDraft;
  onClose: () => void;
  onPublished: (post: any) => void;
};

/**
 * Notion-style block editor that replaces the legacy raw-HTML PublishModal.
 *
 * Flow:
 * - Mount: parse `draft.content` (HTML from the agent) into BlockNote blocks
 *   via `tryParseHTMLToBlocks`. Anything unparseable falls into a custom
 *   `rawHtml` block which is preserved verbatim on save.
 * - User edits inline (slash menu, drag handles, formatting menu).
 * - On publish: serialise back to HTML via `blocksToFullHTML`, send the
 *   draft + meta through `publishDraft` exactly like the previous modal.
 *
 * Meta (title, slug, excerpt, status, tags) stays as form fields because the
 * agent emits these as JSON fields, not as block content.
 */
export function PublishEditor({ draft, onClose, onPublished }: Props) {
  const [meta, setMeta] = useState<WpDraft>(draft);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  const editor = useCreateBlockNote({
    schema: editorSchema,
    initialContent: [{ type: "paragraph", content: "" }] as any,
  });

  // Hydrate the editor from `draft.content` (HTML from the agent) on mount.
  // BlockNote's parser handles common tags; anything else falls into a
  // single rawHtml block to preserve fidelity (shortcodes, embeds, etc.).
  useEffect(() => {
    if (initialised.current) return;
    if (!editor) return;
    initialised.current = true;
    const html = draft.content || "";
    if (!html.trim()) return;
    void (async () => {
      try {
        const blocks = await editor.tryParseHTMLToBlocks(html);
        if (blocks.length > 0) {
          editor.replaceBlocks(
            editor.document.map((b: any) => b.id),
            blocks,
          );
        } else {
          editor.replaceBlocks(editor.document.map((b: any) => b.id), [
            { type: "rawHtml", props: { html } } as any,
          ]);
        }
      } catch {
        // Hard fallback: keep the original HTML in a rawHtml block.
        editor.replaceBlocks(editor.document.map((b: any) => b.id), [
          { type: "rawHtml", props: { html } } as any,
        ]);
      }
    })();
  }, [editor, draft.content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update<K extends keyof WpDraft>(key: K, value: WpDraft[K]) {
    setMeta((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const html = await editor.blocksToFullHTML(editor.document);
      const post = await publishDraft({ ...meta, content: html });
      onPublished(post);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  const title = useMemo(() => {
    if (meta.action === "update") return `Mettre à jour #${meta.id}`;
    return "Nouvel article WordPress";
  }, [meta.action, meta.id]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4 z-50 animate-[fadeIn_120ms_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="surface rounded-none sm:rounded-xl shadow-elevated w-full sm:max-w-3xl h-[100dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-md tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors"
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

        {/* Title + slug + excerpt as form fields (agent emits these as JSON) */}
        <div className="px-4 sm:px-5 pt-3 space-y-2 flex-shrink-0">
          <input
            className="input !text-lg !font-semibold !py-2"
            value={meta.title || ""}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Titre de l'article"
            autoFocus
          />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              className="input font-mono !text-sm"
              value={meta.slug || ""}
              onChange={(e) => update("slug", e.target.value)}
              placeholder="auto-generated-from-title"
            />
            <select
              className="input !text-sm sm:!w-32"
              value={meta.status || "draft"}
              onChange={(e) => update("status", e.target.value as WpDraft["status"])}
            >
              <option value="draft">draft</option>
              <option value="publish">publish</option>
              <option value="pending">pending</option>
              <option value="private">private</option>
            </select>
          </div>
          <textarea
            className="input !text-sm min-h-[44px] resize-y"
            value={meta.excerpt || ""}
            onChange={(e) => update("excerpt", e.target.value)}
            placeholder="Extrait court (< 160 caractères)"
          />
        </div>

        {/* The editor itself fills the remaining space */}
        <div className="bn-shell mt-2 border-t border-border">
          <BlockNoteView editor={editor} theme="dark" />
        </div>

        {/* Footer: tags + actions */}
        <div className="px-4 sm:px-5 py-3 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2 bg-bg-primary flex-shrink-0">
          <input
            className="input !text-sm flex-1"
            value={(meta.tags || []).join(", ")}
            onChange={(e) =>
              update(
                "tags",
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              )
            }
            placeholder="tags, séparés, par, virgules"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">
              Annuler
            </button>
            <button onClick={handlePublish} disabled={publishing} className="btn-primary">
              {publishing
                ? "Envoi…"
                : meta.action === "create"
                  ? "Publier"
                  : "Mettre à jour"}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-300 bg-red-500/10 border-t border-red-500/40 rounded-none px-4 py-2 flex-shrink-0">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
