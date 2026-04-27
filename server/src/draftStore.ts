import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  BlockOp,
  DraftBlock,
  DraftEvent,
  PostMeta,
} from "./contract.js";
import { emptyMeta } from "./contract.js";

interface DraftState {
  blocks: DraftBlock[];
  meta: PostMeta;
  /** Snapshot at last `doc_load` — used by the editor for diff/review. */
  original: DraftBlock[] | null;
}

class Draft {
  state: DraftState = {
    blocks: [],
    meta: { ...emptyMeta },
    original: null,
  };
  /** Connected SSE clients listening for draft events. */
  listeners = new Set<Response>();

  emit(ev: DraftEvent) {
    const payload = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch {
        this.listeners.delete(res);
      }
    }
  }

  snapshot(): DraftEvent {
    return {
      type: "draft.snapshot",
      blocks: this.state.blocks,
      meta: this.state.meta,
      original: this.state.original,
    };
  }

  apply(op: BlockOp): { ok: boolean; touchedId?: string; error?: string } {
    const s = this.state;
    switch (op.op) {
      case "doc_init": {
        s.blocks = op.blocks.map(ensureId);
        s.original = null;
        s.meta = {
          ...emptyMeta,
          post_id: op.post_id,
          title: s.meta.title,
          slug: s.meta.slug,
        };
        return { ok: true };
      }
      case "doc_load": {
        const withIds = op.blocks.map(ensureId);
        s.blocks = withIds;
        s.original = JSON.parse(JSON.stringify(withIds));
        s.meta = { ...op.meta, post_id: op.post_id };
        return { ok: true };
      }
      case "block_insert": {
        const block = ensureId(op.block);
        if (!op.after_id) {
          s.blocks.unshift(block);
        } else {
          const i = s.blocks.findIndex((b) => b.id === op.after_id);
          if (i === -1) {
            s.blocks.push(block);
          } else {
            s.blocks.splice(i + 1, 0, block);
          }
        }
        return { ok: true, touchedId: block.id };
      }
      case "block_update": {
        const i = s.blocks.findIndex((b) => b.id === op.id);
        if (i === -1) return { ok: false, error: `unknown block_id ${op.id}` };
        s.blocks[i] = { ...s.blocks[i], ...op.patch, id: s.blocks[i].id };
        return { ok: true, touchedId: op.id };
      }
      case "block_append_text": {
        const i = s.blocks.findIndex((b) => b.id === op.id);
        if (i === -1) return { ok: false, error: `unknown block_id ${op.id}` };
        const cur = s.blocks[i];
        const prev = typeof cur.content === "string" ? cur.content : "";
        s.blocks[i] = { ...cur, content: prev + op.delta };
        return { ok: true, touchedId: op.id };
      }
      case "block_delete": {
        const before = s.blocks.length;
        s.blocks = s.blocks.filter((b) => b.id !== op.id);
        if (s.blocks.length === before)
          return { ok: false, error: `unknown block_id ${op.id}` };
        return { ok: true, touchedId: op.id };
      }
      case "block_move": {
        const i = s.blocks.findIndex((b) => b.id === op.id);
        if (i === -1) return { ok: false, error: `unknown block_id ${op.id}` };
        const [block] = s.blocks.splice(i, 1);
        if (!op.after_id) {
          s.blocks.unshift(block);
        } else {
          const j = s.blocks.findIndex((b) => b.id === op.after_id);
          if (j === -1) s.blocks.push(block);
          else s.blocks.splice(j + 1, 0, block);
        }
        return { ok: true, touchedId: op.id };
      }
      case "meta_update": {
        s.meta = { ...s.meta, ...op.meta, seo: { ...s.meta.seo, ...(op.meta.seo || {}) } };
        return { ok: true };
      }
    }
  }
}

function ensureId(b: DraftBlock): DraftBlock {
  if (b.id) return b;
  return { ...b, id: randomUUID() };
}

const drafts = new Map<string, Draft>();

export function getDraft(sessionId: string): Draft {
  let d = drafts.get(sessionId);
  if (!d) {
    d = new Draft();
    drafts.set(sessionId, d);
  }
  return d;
}

export function dropDraft(sessionId: string) {
  drafts.delete(sessionId);
}
