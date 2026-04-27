import { useEffect, useRef } from "react";
import type { BlockOp, DraftEvent } from "../../contract";
import { draftToBN } from "./blockConvert";

type Editor = any;

/**
 * Module-level flag set to true while we're applying an agent-emitted op
 * to BlockNote (replaceBlocks/insertBlocks/updateBlock etc.). InlineEditor's
 * onChange handler reads this flag and skips its user-edit flush so we don't
 * round-trip agent ops back to the server (which would also incorrectly mark
 * those blocks as `user_edited` in DOC_STATE).
 */
export const agentOpFlag = { applying: false };

interface Options {
  editor: Editor | null;
  sessionId: string | null;
  onSnapshot: (ev: Extract<DraftEvent, { type: "draft.snapshot" }>) => void;
  /** Called when the agent emits a doc_load (post hydration) so the parent
   * can sync the meta panel and the original snapshot for the diff view. */
  onDocLoad?: (op: Extract<BlockOp, { op: "doc_load" }>) => void;
  /** Called when the agent emits a meta_update so the parent can update its
   * meta state (used by auto-publish hook on meta.status changes). */
  onMetaUpdate?: (patch: Extract<BlockOp, { op: "meta_update" }>["meta"]) => void;
  /** Called whenever a block was edited by the agent — used to highlight. */
  onAgentTouch: (blockId: string) => void;
}

/**
 * Subscribes to /api/sessions/:id/draft/stream and applies block ops to the
 * editor. `block_append_text` deltas are coalesced at 16ms (60fps) so a long
 * stream produces one BlockNote transaction per frame instead of one per
 * token, while still feeling like a typewriter.
 */
export function useAgentBlockOps({
  editor,
  sessionId,
  onSnapshot,
  onDocLoad,
  onMetaUpdate,
  onAgentTouch,
}: Options) {
  const pendingAppends = useRef<Map<string, string>>(new Map());
  const rafRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!editor || !sessionId) return;

    function flushAppends() {
      rafRef.current = null;
      const map = pendingAppends.current;
      pendingAppends.current = new Map();
      agentOpFlag.applying = true;
      try {
      for (const [id, delta] of map) {
        const block = editor.getBlock(id);
        if (!block) continue;
        const cur = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? extractText(block.content)
            : "";
        editor.updateBlock(id, { content: cur + delta } as any);
        onAgentTouch(id);
      }
      } finally {
        queueMicrotask(() => {
          agentOpFlag.applying = false;
        });
      }
    }

    function scheduleFlush() {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(flushAppends);
    }

    /**
     * BlockNote/ProseMirror leave atom blocks (rawHtml, image, table) in a
     * dead-end state if they're the very last block: clicks anywhere just
     * keep selecting the atom block since there's no neighbour to land on.
     * Ensure a trailing empty paragraph exists so the user can always click
     * below to deselect or start typing.
     */
    function ensureTrailingParagraph() {
      const doc = editor.document;
      const last = doc[doc.length - 1];
      if (!last) return;
      const ATOMIC = new Set(["rawHtml", "image", "table"]);
      if (ATOMIC.has(last.type)) {
        editor.insertBlocks(
          [{ type: "paragraph", content: "" } as any],
          last.id,
          "after",
        );
      }
    }

    function applyOp(op: BlockOp, touchedId?: string) {
      agentOpFlag.applying = true;
      try {
        return applyOpInner(op, touchedId);
      } finally {
        // Defer the flag reset to next tick so BlockNote's onChange (which
        // fires synchronously after replaceBlocks) sees the flag still true.
        queueMicrotask(() => {
          agentOpFlag.applying = false;
        });
      }
    }

    function applyOpInner(op: BlockOp, touchedId?: string) {
      switch (op.op) {
        case "doc_init":
        case "doc_load": {
          const blocks = op.blocks.map(draftToBN);
          editor.replaceBlocks(editor.document.map((b: any) => b.id), blocks);
          if (op.op === "doc_load") onDocLoad?.(op);
          ensureTrailingParagraph();
          break;
        }
        case "block_insert": {
          const block = draftToBN(op.block);
          if (op.after_id) {
            const ref = editor.getBlock(op.after_id);
            if (ref) editor.insertBlocks([block], op.after_id, "after");
            else editor.insertBlocks([block], editor.document.at(-1).id, "after");
          } else if (editor.document.length === 0) {
            editor.replaceBlocks([], [block]);
          } else {
            editor.insertBlocks([block], editor.document[0].id, "before");
          }
          if (touchedId || op.block.id) onAgentTouch(touchedId || op.block.id);
          ensureTrailingParagraph();
          break;
        }
        case "block_update": {
          const id = op.id;
          const block = editor.getBlock(id);
          if (!block) break;
          // Convert patch to BN partial via a synthesised DraftBlock
          const merged = { id, type: op.patch.type || draftTypeFromBN(block.type), ...op.patch };
          editor.updateBlock(id, draftToBN(merged as any) as any);
          onAgentTouch(id);
          break;
        }
        case "block_append_text": {
          const cur = pendingAppends.current.get(op.id) || "";
          pendingAppends.current.set(op.id, cur + op.delta);
          scheduleFlush();
          break;
        }
        case "block_delete": {
          editor.removeBlocks([op.id]);
          break;
        }
        case "block_move": {
          const block = editor.getBlock(op.id);
          if (!block) break;
          const json = block;
          editor.removeBlocks([op.id]);
          if (op.after_id) {
            const ref = editor.getBlock(op.after_id);
            if (ref) editor.insertBlocks([json], op.after_id, "after");
          } else if (editor.document.length === 0) {
            editor.replaceBlocks([], [json]);
          } else {
            editor.insertBlocks([json], editor.document[0].id, "before");
          }
          onAgentTouch(op.id);
          break;
        }
        case "meta_update":
          // No editor mutation, but propagate so the parent's meta state
          // (and the auto-publish hook keyed on meta.status) refreshes.
          onMetaUpdate?.(op.meta);
          break;
      }
    }

    function connect() {
      const es = new EventSource(`/api/sessions/${sessionId}/draft/stream`);
      esRef.current = es;
      es.onopen = () => {
        attempts.current = 0;
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        const delay = Math.min(8000, 500 * 2 ** attempts.current);
        attempts.current++;
        reconnectTimer.current = window.setTimeout(connect, delay);
      };
      es.onmessage = (e) => {
        let data: DraftEvent;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        if (data.type === "draft.snapshot") {
          if (data.blocks.length) {
            editor.replaceBlocks(
              editor.document.map((b: any) => b.id),
              data.blocks.map(draftToBN),
            );
          }
          onSnapshot(data);
        } else if (data.type === "draft.op") {
          applyOp(data.op, data.touched_block_id);
        }
      };
    }

    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [editor, sessionId, onSnapshot, onAgentTouch]);
}

function draftTypeFromBN(t: string): string {
  if (t === "codeBlock") return "code";
  if (t === "rawHtml") return "raw_html";
  return t;
}

function extractText(content: any[]): string {
  return content
    .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
    .join("");
}
