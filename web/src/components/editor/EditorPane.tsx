import { useCallback, useEffect, useState } from "react";
import { InlineEditor, type EditorHandle } from "./InlineEditor";
import { ReviewBadges } from "./ReviewBadges";
import { PrePublishReview } from "./PrePublishReview";
import { CmdKMenu } from "./CmdKMenu";
import { MetaDrawer } from "./MetaDrawer";
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
 * meta sidebar (slug / excerpt / tags / SEO) and a Cmd+K menu wired to
 * send selection-scoped prompts to the agent. The agent mutates the doc
 * via block_* tools → SSE draft.* events.
 */
export function EditorPane({
  sessionId,
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
      {/* Slim toolbar: title (full width) + status pill + Méta + Publier
          + close. Tertiary actions (load existing post, undo agent) live
          in the MetaDrawer footer. */}
      <div className="border-b border-border flex-shrink-0 px-3 py-2 flex items-center gap-2">
        <input
          className="input !py-1.5 !text-md flex-1 min-w-0 !font-medium !border-transparent !bg-transparent focus:!border-border focus:!bg-bg-tertiary"
          value={meta.title}
          onChange={(e) => onMetaChange({ title: e.target.value })}
          placeholder="Titre de l'article…"
          aria-label="Titre"
        />
        <select
          className="input !py-1 !text-xs !w-auto"
          value={meta.status}
          onChange={(e) => onMetaChange({ status: e.target.value as any })}
          aria-label="Statut"
        >
          <option value="draft">Brouillon</option>
          <option value="publish">Publier</option>
          <option value="pending">En attente</option>
          <option value="private">Privé</option>
        </select>
        <button
          type="button"
          onClick={() => setShowMeta(true)}
          className="btn-ghost !py-1 !px-2 text-xs flex-shrink-0"
          title="Slug, extrait, tags, SEO"
          aria-label="Ouvrir le panneau méta"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => publish(meta.status)}
          disabled={busy || !sessionId}
          className="btn-primary !py-1 !px-3 text-xs flex-shrink-0"
        >
          {busy
            ? "…"
            : meta.status === "publish"
              ? isUpdate
                ? "Mettre à jour"
                : "Publier"
              : "Enregistrer"}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="btn-ghost flex-shrink-0 !p-1"
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

      {/* Pre-publish review (legal / fact-check / internal links). */}
      <div className="px-3 pt-2 flex-shrink-0">
        <PrePublishReview
          sessionId={sessionId}
          onFocusBlock={(id) => editorHandle?.scrollToBlock(id)}
        />
      </div>

      {/* Quick actions strip — only when a block is selected. Slim
          horizontal pill, icon-only buttons with aria-labels. */}
      {selectionBlockIds.length > 0 && (
        <div className="px-3 pt-2 flex-shrink-0">
          <div
            role="toolbar"
            aria-label="Actions de bloc"
            className="inline-flex items-center gap-0.5 bg-bg-tertiary border border-border rounded-md px-1 py-1 text-xs"
          >
            <span className="text-text-tertiary px-1.5 select-none">
              {selectionBlockIds.length === 1
                ? "Bloc :"
                : `${selectionBlockIds.length} blocs :`}
            </span>
            <ActionBtn
              label="Reformuler"
              icon="✦"
              onClick={() => quickAction("Reformule ce bloc.")}
            />
            <ActionBtn
              label="Raccourcir"
              icon="↓"
              onClick={() => quickAction("Raccourcis ce bloc.")}
            />
            <ActionBtn
              label="Allonger"
              icon="↑"
              onClick={() => quickAction("Développe ce bloc.")}
            />
            <ActionBtn
              label="Corriger"
              icon="✓"
              onClick={() => quickAction("Corrige fautes et tournures de ce bloc.")}
            />
            <ActionBtn
              label="Traduire en anglais"
              icon="🇬🇧"
              onClick={() => quickAction("Traduis ce bloc en anglais.")}
            />
            <span className="w-px h-5 bg-border mx-0.5" />
            <ActionBtn
              label={
                selectionBlockIds.every((id) => lockedIds.has(id))
                  ? "Déverrouiller"
                  : "Verrouiller"
              }
              icon={
                selectionBlockIds.every((id) => lockedIds.has(id)) ? "🔓" : "🔒"
              }
              onClick={toggleLock}
            />
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

      <div className="flex-1 min-h-0 flex">
        <InlineEditor
          sessionId={sessionId}
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
      </div>

      <MetaDrawer
        open={showMeta}
        meta={meta}
        onChange={onMetaChange}
        onClose={() => setShowMeta(false)}
        onLoadPost={() => {
          setShowMeta(false);
          loadById();
        }}
        onUndoAgent={() => {
          setShowMeta(false);
          undoAgentTurn();
        }}
      />

      <CmdKMenu
        selectionBlockIds={selectionBlockIds}
        onSubmit={(prompt, preset) => sendCmdK(prompt, preset)}
      />
    </div>
  );
}

function ActionBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="px-1.5 py-0.5 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors leading-none"
    >
      {icon}
    </button>
  );
}
