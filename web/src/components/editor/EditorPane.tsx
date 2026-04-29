import { useCallback, useEffect, useRef, useState } from "react";
import { InlineEditor, type EditorHandle } from "./InlineEditor";
import { ReviewBadges } from "./ReviewBadges";
import { PrePublishReview } from "./PrePublishReview";
import { CmdKMenu } from "./CmdKMenu";
import { useAutosave, clearStored } from "../../lib/useAutosave";
import { type DraftBlock, type PostMeta, emptyMeta } from "../../contract";
import {
  publishCurrentDraft,
  patchDraftMeta,
  loadPostIntoDraft,
  sendMessage,
  undoAgent,
  setBlockLock,
} from "../../api";

interface Props {
  sessionId: string | null;
  /** Optional seed when the user clicks "Edit inline" on a wp-post DraftCard. */
  seedHtml?: string | null;
  /** "auto" → publish automatically when meta.status flips to "publish" via
   *  an agent meta_update. "validate" → user must click the Publish button. */
  mode?: "auto" | "validate";
  /** Block ids the agent is currently working on — receive a shimmer in
   *  the editor until the agent goes idle. Cleared by the parent. */
  pendingAgentBlockIds?: string[];
  onClose?: () => void;
  onPublished: (post: { id: number; link?: string }) => void;
  onToast: (msg: string) => void;
  /** Bubbled up so App.tsx can include the current selection's block_ids
   *  in every user.message it sends (DOC_STATE.selection). */
  onSelectionChange?: (blockIds: string[]) => void;
  /** Fired when the user clicks a quick action (Reformuler, Raccourcir…)
   *  on a selected block, so the parent can mark those ids as pending. */
  onQuickAction?: (blockIds: string[]) => void;
}

/**
 * Right-pane block editor surface. Renders the BlockNote editor plus a
 * meta sidebar (title / slug / excerpt / status / tags / SEO), a review
 * badge bar, and a Cmd+K menu wired to send selection-scoped prompts to
 * the agent.
 *
 * The editor is hydrated by:
 * - the agent (via block_* tools → SSE draft.* events), and/or
 * - a `seedHtml` if the user clicked "Edit inline" on a wp-post DraftCard.
 */
export function EditorPane({
  sessionId,
  seedHtml,
  mode = "validate",
  pendingAgentBlockIds,
  onClose,
  onPublished,
  onToast,
  onSelectionChange,
  onQuickAction,
}: Props) {
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);
  const [meta, setMeta] = useState<PostMeta>(emptyMeta);
  const [original, setOriginal] = useState<DraftBlock[] | null>(null);
  const [currentBlocks, setCurrentBlocks] = useState<DraftBlock[]>([]);
  const [selectionBlockIds, setSelectionBlockIds] = useState<string[]>([]);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  // Sync currentBlocks from editor periodically (for diff/autosave).
  useEffect(() => {
    if (!editorHandle) return;
    const t = window.setInterval(() => {
      const blocks = editorHandle.getBlocks();
      setCurrentBlocks((prev) =>
        JSON.stringify(prev) === JSON.stringify(blocks) ? prev : blocks,
      );
    }, 800);
    return () => window.clearInterval(t);
  }, [editorHandle]);

  useAutosave(sessionId, currentBlocks, meta);

  const onMetaChange = useCallback(
    (patch: Partial<PostMeta>) => {
      setMeta((m) => ({
        ...m,
        ...patch,
        seo: { ...m.seo, ...(patch.seo || {}) },
      }));
      if (sessionId) patchDraftMeta(sessionId, patch).catch(() => {});
    },
    [sessionId],
  );

  const onSnapshotMeta = useCallback((m: PostMeta) => setMeta(m), []);
  const onSnapshotOriginal = useCallback(
    (b: DraftBlock[] | null) => setOriginal(b),
    [],
  );
  const onSnapshotBlockMeta = useCallback(
    (bm: Record<string, { locked?: boolean }>) => {
      const out = new Set<string>();
      for (const [id, m] of Object.entries(bm || {})) {
        if (m?.locked) out.add(id);
      }
      setLockedIds(out);
    },
    [],
  );

  // Apply data-locked attr on the editor blocks for the lock badge CSS.
  useEffect(() => {
    const root = document.querySelector(".bn-editor");
    if (!root) return;
    root
      .querySelectorAll<HTMLElement>("[data-locked]")
      .forEach((el) => el.removeAttribute("data-locked"));
    for (const id of lockedIds) {
      const el = root.querySelector<HTMLElement>(
        `.bn-block-outer[data-id="${id}"]`,
      );
      if (el) el.setAttribute("data-locked", "true");
    }
  }, [lockedIds, currentBlocks]);

  // Pending shimmer on blocks the agent is currently working on. We use a
  // MutationObserver so the attribute survives BlockNote's re-render cycles
  // (a draft.op block_update tears down + recreates the .bn-block-outer DOM
  // node, dropping our manually-set data-agent-pending attr otherwise).
  useEffect(() => {
    const root = document.querySelector(".bn-editor");
    if (!root) return;
    const apply = () => {
      root
        .querySelectorAll<HTMLElement>("[data-agent-pending]")
        .forEach((el) => el.removeAttribute("data-agent-pending"));
      for (const id of pendingAgentBlockIds || []) {
        const el = root.querySelector<HTMLElement>(
          `.bn-block-outer[data-id="${id}"]`,
        );
        if (el) el.setAttribute("data-agent-pending", "true");
      }
    };
    apply();
    if (!pendingAgentBlockIds || pendingAgentBlockIds.length === 0) return;
    // Re-apply on every DOM mutation under the editor while pending — covers
    // the brief window when the agent's block_update tears down + recreates
    // the matching .bn-block-outer. Throttle via rAF so we don't run on every
    // single mutation when BlockNote re-renders heavily.
    let raf: number | null = null;
    const obs = new MutationObserver(() => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        apply();
      });
    });
    obs.observe(root, { childList: true, subtree: true, attributes: false });
    return () => {
      obs.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [pendingAgentBlockIds]);

  function revertBlock(b: DraftBlock) {
    if (!editorHandle) return;
    const blocks = editorHandle.getBlocks();
    const exists = blocks.some((x) => x.id === b.id);
    if (exists) {
      editorHandle.setBlocks(blocks.map((x) => (x.id === b.id ? b : x)));
    } else {
      editorHandle.setBlocks([...blocks, b]);
    }
  }

  // Auto-publish: in "auto" mode, when the agent flips meta.status to a
  // publish-like value via meta_update, publish automatically. We track the
  // last meta we published for so a subsequent edit can re-publish (the
  // agent could update + re-publish the same post). Only triggers on
  // transitions, not on the initial snapshot.
  const lastAutoPublishedRef = useRef<string>("");
  useEffect(() => {
    if (mode !== "auto") return;
    if (!sessionId) return;
    if (busy) return;
    const triggerable = ["publish", "future"].includes(meta.status);
    if (!triggerable) return;
    if (!meta.title?.trim()) return; // no point auto-publishing an untitled doc
    // Hash on (post_id || "new") + status + title — re-trigger when any
    // changes meaningfully (e.g. user/agent updates and re-flips to publish)
    const key = `${meta.post_id || "new"}|${meta.status}|${meta.title}`;
    if (key === lastAutoPublishedRef.current) return;
    lastAutoPublishedRef.current = key;
    void publish(meta.status);
  }, [meta.status, meta.title, meta.post_id, mode, sessionId, busy]);

  async function publish(status?: string) {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await publishCurrentDraft(sessionId, status);
      clearStored(sessionId);
      onPublished(result);
      onToast(`✓ Publié · ${result.link || `#${result.id}`}`);
    } catch (err: any) {
      onToast(`Erreur · ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadById() {
    if (!sessionId) return;
    const id = window.prompt("ID de l'article WordPress à charger ?");
    if (!id) return;
    try {
      await loadPostIntoDraft(sessionId, Number(id));
      onToast(`Article #${id} chargé`);
    } catch (err: any) {
      onToast(`Erreur · ${err.message}`);
    }
  }

  async function undoAgentTurn() {
    if (!sessionId) return;
    try {
      await undoAgent(sessionId);
      onToast("↶ Dernière intervention de l'agent annulée");
    } catch (err: any) {
      onToast(err.message || "Rien à annuler");
    }
  }

  /** Toggle lock on the currently selected block(s). */
  async function toggleLock() {
    if (!sessionId || selectionBlockIds.length === 0) return;
    const allLocked = selectionBlockIds.every((id) => lockedIds.has(id));
    const next = !allLocked;
    try {
      await Promise.all(
        selectionBlockIds.map((id) => setBlockLock(sessionId, id, next)),
      );
      setLockedIds((prev) => {
        const out = new Set(prev);
        for (const id of selectionBlockIds) {
          if (next) out.add(id);
          else out.delete(id);
        }
        return out;
      });
      onToast(next ? "🔒 Bloc(s) verrouillé(s)" : "🔓 Bloc(s) déverrouillé(s)");
    } catch (err: any) {
      onToast(`Erreur · ${err.message}`);
    }
  }

  /** Ask the agent to operate on the currently-selected block(s). */
  async function quickAction(prompt: string) {
    if (!sessionId) return;
    if (selectionBlockIds.length === 0) {
      onToast("Sélectionne un bloc dans l'éditeur d'abord");
      return;
    }
    onQuickAction?.(selectionBlockIds.slice());
    try {
      await sendMessage(sessionId, prompt, {
        selection_block_ids: selectionBlockIds,
      });
    } catch (err: any) {
      onToast(`Erreur · ${err.message}`);
      onQuickAction?.([]);
    }
  }

  async function sendCmdK(prompt: string, preset?: string) {
    if (!sessionId) return;
    const tag =
      selectionBlockIds.length > 0
        ? `[selection block_ids=${selectionBlockIds.join(",")}${preset ? ` preset=${preset}` : ""}]\n`
        : "";
    await sendMessage(sessionId, `${tag}${prompt}`);
  }

  const isUpdate = Boolean(meta.post_id);

  return (
    <div className="h-full w-full flex flex-col bg-bg-secondary">
      {/* Toolbar — wraps on mobile so the title gets a full row of breathing
          room and the action buttons go below it. */}
      <div className="border-b border-border flex-shrink-0 px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <input
            className="input !py-1.5 !text-sm flex-1 min-w-0 !font-medium"
            value={meta.title}
            onChange={(e) => onMetaChange({ title: e.target.value })}
            placeholder="Titre de l'article…"
          />
          {onClose && (
            <button
              onClick={onClose}
              className="btn-ghost flex-shrink-0 !px-2"
              aria-label="Fermer l'éditeur"
              title="Fermer l'éditeur"
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
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={loadById}
            className="btn-ghost"
            title="Charger un article WP par ID"
          >
            Charger…
          </button>
          <button
            onClick={undoAgentTurn}
            className="btn-ghost"
            title="Annule la dernière action de l'agent (block_insert / block_update / block_delete du dernier tour)"
          >
            ↶ Annuler agent
          </button>
          <button
            onClick={() => setShowMeta((s) => !s)}
            className="btn-ghost"
            title="Slug, extrait, tags, SEO"
          >
            ⚙ Méta
          </button>
          <div className="flex-1" />
          <select
            className="input !py-1 !text-sm !w-auto"
            value={meta.status}
            onChange={(e) => onMetaChange({ status: e.target.value as any })}
          >
            <option value="draft">Brouillon</option>
            <option value="publish">Publier</option>
            <option value="pending">En attente</option>
            <option value="private">Privé</option>
          </select>
          <button
            onClick={() => publish(meta.status)}
            disabled={busy || !sessionId}
            className="btn-primary"
          >
            {busy
              ? "…"
              : meta.status === "publish"
                ? isUpdate
                  ? "Mettre à jour"
                  : "Publier"
                : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* Pre-publish review (legal / fact-check / internal links). */}
      <div className="px-3 pt-2 flex-shrink-0">
        <PrePublishReview
          sessionId={sessionId}
          onFocusBlock={(id) => editorHandle?.scrollToBlock(id)}
        />
      </div>

      {/* Quick actions bar — appears when any block is selected. */}
      {selectionBlockIds.length > 0 && (
        <div className="px-3 pt-2 flex-shrink-0">
          <div className="flex items-center flex-wrap gap-1 text-xs bg-bg-tertiary border border-border rounded-md px-2 py-1">
            <span className="text-text-tertiary mr-1">
              {selectionBlockIds.length === 1
                ? "Bloc sélectionné →"
                : `${selectionBlockIds.length} blocs sélectionnés →`}
            </span>
            <button
              onClick={() => quickAction("Reformule ce bloc.")}
              className="btn-ghost !py-0.5 !px-1.5"
            >
              ✦ Reformuler
            </button>
            <button
              onClick={() => quickAction("Raccourcis ce bloc.")}
              className="btn-ghost !py-0.5 !px-1.5"
            >
              ↓ Raccourcir
            </button>
            <button
              onClick={() => quickAction("Développe ce bloc.")}
              className="btn-ghost !py-0.5 !px-1.5"
            >
              ↑ Allonger
            </button>
            <button
              onClick={() => quickAction("Corrige fautes et tournures de ce bloc.")}
              className="btn-ghost !py-0.5 !px-1.5"
            >
              ✓ Corriger
            </button>
            <button
              onClick={() => quickAction("Traduis ce bloc en anglais.")}
              className="btn-ghost !py-0.5 !px-1.5"
            >
              🇬🇧 Anglais
            </button>
            <button
              onClick={toggleLock}
              className="btn-ghost !py-0.5 !px-1.5"
              title={
                selectionBlockIds.every((id) => lockedIds.has(id))
                  ? "Déverrouiller — l'agent peut à nouveau modifier"
                  : "Verrouiller — l'agent ne pourra plus toucher à ce bloc"
              }
            >
              {selectionBlockIds.every((id) => lockedIds.has(id))
                ? "🔓 Déverrouiller"
                : "🔒 Verrouiller"}
            </button>
          </div>
        </div>
      )}

      {/* Review badges (when an original snapshot exists) */}
      {original && (
        <div className="px-3 pt-2 flex-shrink-0">
          <ReviewBadges
            editor={editorHandle}
            current={currentBlocks}
            original={original}
            onRevertBlock={revertBlock}
          />
        </div>
      )}

      {/* Featured image banner. Shown when meta.featured_media_url is set
          but the agent forgot to also insert a corresponding block image
          inside the doc — at least the user sees it. */}
      {meta.featured_media_url &&
        !currentBlocks.some(
          (b) =>
            b.type === "image" &&
            (b.props as any)?.url === meta.featured_media_url,
        ) && (
          <div className="px-3 pt-2 flex-shrink-0">
            <div className="surface rounded-md flex items-center gap-2 p-2 text-xs">
              <img
                src={meta.featured_media_url}
                alt=""
                className="h-12 w-20 rounded border border-border object-cover"
              />
              <div className="flex-1 min-w-0">
                <div className="text-text-tertiary uppercase tracking-wide">
                  Image à la une
                </div>
                <div className="text-text-muted truncate font-mono text-[11px]">
                  {meta.featured_media_url}
                </div>
              </div>
            </div>
          </div>
        )}

      <div className="flex-1 min-h-0 flex">
        <InlineEditor
          sessionId={sessionId}
          seedHtml={seedHtml}
          onMetaSnapshot={onSnapshotMeta}
          onBlockMeta={onSnapshotBlockMeta}
          onMetaPatch={(patch) => {
            // The agent emitted a meta_update — merge into local meta state so
            // the auto-publish hook (keyed on meta.status) re-evaluates.
            setMeta((m) => ({
              ...m,
              ...patch,
              seo: { ...m.seo, ...(patch.seo || {}) },
            }));
          }}
          onOriginalSnapshot={onSnapshotOriginal}
          onSelectionChange={(s) => {
            const ids = s?.block_ids ?? [];
            setSelectionBlockIds(ids);
            onSelectionChange?.(ids);
          }}
          onReady={setEditorHandle}
        />

        {/* Meta sidebar (toggleable) */}
        {showMeta && (
          <aside className="w-72 border-l border-border bg-bg-secondary p-3 overflow-auto text-sm space-y-3 flex-shrink-0">
            <div>
              <label className="text-xs uppercase tracking-wide text-text-tertiary">
                Slug
              </label>
              <input
                className="input mt-1 font-mono !text-sm"
                value={meta.slug}
                onChange={(e) => onMetaChange({ slug: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-text-tertiary">
                Extrait
              </label>
              <textarea
                className="input mt-1 min-h-[60px] resize-y !text-sm"
                value={meta.excerpt}
                onChange={(e) => onMetaChange({ excerpt: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-text-tertiary">
                Tags (virgules)
              </label>
              <input
                className="input mt-1 !text-sm"
                value={(meta.tags || []).join(", ")}
                onChange={(e) =>
                  onMetaChange({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <details>
              <summary className="text-xs uppercase tracking-wide text-text-tertiary cursor-pointer">
                SEO
              </summary>
              <div className="mt-2 space-y-2">
                <input
                  className="input !text-sm"
                  placeholder="Meta title"
                  value={meta.seo.title || ""}
                  onChange={(e) =>
                    onMetaChange({ seo: { ...meta.seo, title: e.target.value } })
                  }
                />
                <textarea
                  className="input !text-sm min-h-[60px] resize-y"
                  placeholder="Meta description"
                  value={meta.seo.description || ""}
                  onChange={(e) =>
                    onMetaChange({
                      seo: { ...meta.seo, description: e.target.value },
                    })
                  }
                />
                <input
                  className="input !text-sm"
                  placeholder="Mot-clé focus"
                  value={meta.seo.focus_keyword || ""}
                  onChange={(e) =>
                    onMetaChange({
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
          </aside>
        )}
      </div>

      <CmdKMenu
        selectionBlockIds={selectionBlockIds}
        onSubmit={(prompt, preset) => sendCmdK(prompt, preset)}
      />
    </div>
  );
}
