import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
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
  /**
   * Per-block edit metadata. Mapped by blockId. Used to:
   * - Tell the agent which blocks the user has manually modified (so it
   *   can avoid clobbering them carelessly).
   * - Power undo by replaying the inverse of the last agent batch.
   */
  blockMeta: Record<
    string,
    {
      user_edited_at?: number;
      agent_edited_at?: number;
      /** Hard lock: agent ops are refused on this block until cleared. */
      locked?: boolean;
    }
  >;
  /**
   * Ops emitted in the current "agent turn" (since the last user.message).
   * Each batch is captured as a snapshot of pre-state we can restore on undo.
   * Capped at the most recent 10 turns so memory stays bounded.
   */
  history: Array<{
    started_at: number;
    /** Snapshot of blocks BEFORE this turn started — used to undo. */
    blocks_before: DraftBlock[];
    blockMeta_before: DraftState["blockMeta"];
    op_count: number;
  }>;
  /** Index in history of the currently-running turn (latest), or -1. */
  current_turn_index: number;
}

interface PersistedShape {
  version: 2;
  state: DraftState;
  saved_at: string;
}

/**
 * Where to persist draft state. Read lazily so tests can override
 * DRAFT_DIR in beforeEach without re-importing the module.
 */
function draftDir(): string {
  return process.env.DRAFT_DIR || path.resolve(process.cwd(), "data", "drafts");
}

const ensuredDirs = new Set<string>();
async function ensureDir() {
  const dir = draftDir();
  if (ensuredDirs.has(dir)) return;
  try {
    await fs.mkdir(dir, { recursive: true });
    ensuredDirs.add(dir);
  } catch (err: any) {
    console.warn(`[draftStore] mkdir ${dir} failed:`, err.message);
  }
}

function safeFilename(sessionId: string): string {
  // Defend against path traversal — only allow letters, digits, _, -.
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function pathFor(sessionId: string): string {
  return path.join(draftDir(), `${safeFilename(sessionId)}.json`);
}

class Draft {
  state: DraftState = {
    blocks: [],
    meta: { ...emptyMeta },
    original: null,
    blockMeta: {},
    history: [],
    current_turn_index: -1,
  };
  /** Connected SSE clients listening for draft events. */
  listeners = new Set<Response>();

  /** Persistence: debounce writes so token-by-token block_append_text streams
   *  don't trigger a write per delta. ~500 ms is a sweet spot for "lose at
   *  most a few seconds of work on crash" without being chatty. */
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writeInFlight: Promise<void> | null = null;

  constructor(private sessionId: string) {}

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
      blockMeta: this.state.blockMeta,
    };
  }

  apply(op: BlockOp): { ok: boolean; touchedId?: string; error?: string } {
    const result = this.applyInner(op);
    if (result.ok) {
      // Stamp agent-edited timestamp on the touched block (block ops are by
      // definition agent-emitted at this layer — user edits go through
      // setBlocksFromUser).
      if (result.touchedId) {
        this.state.blockMeta[result.touchedId] = {
          ...this.state.blockMeta[result.touchedId],
          agent_edited_at: Date.now(),
        };
      }
      // Increment op_count of current turn if one is open
      if (this.state.current_turn_index >= 0) {
        const turn = this.state.history[this.state.current_turn_index];
        if (turn) turn.op_count++;
      }
      this.scheduleSave();
    }
    return result;
  }

  /**
   * Replace blocks from a user-driven manual edit (the BlockNote onChange
   * flush). Stamps user_edited_at on every block whose content changed
   * compared to the previous state, so the agent can see what the user
   * touched. Doesn't open a history turn (user undo uses BlockNote's
   * native ProseMirror history).
   */
  setBlocksFromUser(blocks: DraftBlock[]): void {
    const now = Date.now();
    const prevById = new Map(this.state.blocks.map((b) => [b.id, b]));
    for (const b of blocks) {
      const prev = prevById.get(b.id);
      const sameContent =
        prev && JSON.stringify(prev.content) === JSON.stringify(b.content) &&
        JSON.stringify(prev.props) === JSON.stringify(b.props);
      if (!sameContent) {
        this.state.blockMeta[b.id] = {
          ...this.state.blockMeta[b.id],
          user_edited_at: now,
        };
      }
    }
    this.state.blocks = blocks;
    this.scheduleSave();
  }

  /**
   * Conflict gate: returns null if `op` is allowed against the current
   * blockMeta, or an error string if the agent should be blocked. Reads:
   * - locked=true → hard refuse
   * - user_edited_at within USER_EDIT_WINDOW_MS → temporary refuse
   * Used by agentBlockTools.dispatchBlockTool BEFORE applying the op.
   */
  checkConflict(blockId: string): string | null {
    const meta = this.state.blockMeta[blockId];
    if (!meta) return null;
    if (meta.locked) return `block ${blockId} is locked by the user — refused`;
    const userWindow = 15_000;
    if (meta.user_edited_at && Date.now() - meta.user_edited_at < userWindow) {
      const ago = Math.round((Date.now() - meta.user_edited_at) / 1000);
      return `block ${blockId} was edited by the user ${ago}s ago — wait or ask the user before overwriting`;
    }
    return null;
  }

  /** Toggle the lock flag on a block. */
  setBlockLocked(blockId: string, locked: boolean): boolean {
    if (!this.state.blocks.find((b) => b.id === blockId)) return false;
    this.state.blockMeta[blockId] = {
      ...this.state.blockMeta[blockId],
      locked,
    };
    this.scheduleSave();
    return true;
  }

  /**
   * Open a new agent turn — captures the current state so we can undo
   * everything the agent does until the next openTurn() call.
   */
  openTurn(): void {
    const snapshot = {
      started_at: Date.now(),
      blocks_before: JSON.parse(JSON.stringify(this.state.blocks)),
      blockMeta_before: JSON.parse(JSON.stringify(this.state.blockMeta)),
      op_count: 0,
    };
    this.state.history.push(snapshot);
    // Cap to last 10 turns
    if (this.state.history.length > 10) {
      this.state.history.splice(0, this.state.history.length - 10);
    }
    this.state.current_turn_index = this.state.history.length - 1;
    this.scheduleSave();
  }

  /**
   * Roll the most recent turn back to its pre-state. Returns the restored
   * blocks so the caller can emit a snapshot.
   */
  undoLastTurn(): { ok: boolean; reason?: string } {
    // Pick the most recent turn that actually had ops; turns with op_count=0
    // (e.g. user msg with no agent reply yet) are skipped.
    let i = this.state.history.length - 1;
    while (i >= 0 && this.state.history[i].op_count === 0) i--;
    if (i < 0) return { ok: false, reason: "no agent ops to undo" };
    const turn = this.state.history[i];
    this.state.blocks = turn.blocks_before;
    this.state.blockMeta = turn.blockMeta_before;
    this.state.history.splice(i, 1);
    this.state.current_turn_index = -1;
    this.scheduleSave();
    return { ok: true };
  }

  private applyInner(op: BlockOp): {
    ok: boolean;
    touchedId?: string;
    error?: string;
  } {
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
        s.meta = {
          ...s.meta,
          ...op.meta,
          seo: { ...s.meta.seo, ...(op.meta.seo || {}) },
        };
        return { ok: true };
      }
    }
  }

  private scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 500);
  }

  /**
   * Public flush — used after publish() to make sure the post-publish state
   * (e.g. updated post_id + reset original) hits disk before a deploy that
   * could reset the in-memory map.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    if (this.writeInFlight) {
      await this.writeInFlight;
      if (!this.dirty) return;
    }
    this.dirty = false;
    const payload: PersistedShape = {
      version: 2,
      state: this.state,
      saved_at: new Date().toISOString(),
    };
    const file = pathFor(this.sessionId);
    const tmp = `${file}.tmp`;
    this.writeInFlight = (async () => {
      try {
        await ensureDir();
        await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
        await fs.rename(tmp, file);
      } catch (err: any) {
        console.warn(`[draftStore] flush ${this.sessionId} failed:`, err.message);
        // Mark dirty again so the next mutation retries.
        this.dirty = true;
      } finally {
        this.writeInFlight = null;
      }
    })();
    await this.writeInFlight;
  }

  async hydrateFromDisk(): Promise<void> {
    try {
      const file = pathFor(this.sessionId);
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as any;
      // v1 lacked blockMeta/history/current_turn_index — backfill defaults.
      if ((parsed?.version === 1 || parsed?.version === 2) && parsed.state) {
        this.state = {
          blocks: parsed.state.blocks || [],
          meta: { ...emptyMeta, ...(parsed.state.meta || {}), seo: parsed.state.meta?.seo || {} },
          original: parsed.state.original || null,
          blockMeta: parsed.state.blockMeta || {},
          history: parsed.state.history || [],
          current_turn_index:
            typeof parsed.state.current_turn_index === "number"
              ? parsed.state.current_turn_index
              : -1,
        };
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn(`[draftStore] hydrate ${this.sessionId} failed:`, err.message);
      }
    }
  }
}

function ensureId(b: DraftBlock): DraftBlock {
  if (b.id) return b;
  return { ...b, id: randomUUID() };
}

const drafts = new Map<string, Draft>();
/** Promises tracking in-progress hydrate() calls so concurrent getDraft()
 *  invocations (rare but possible: editor SSE + agent tool use racing) don't
 *  each trigger a duplicate read. */
const hydrating = new Map<string, Promise<void>>();

/**
 * Returns the in-memory Draft for a session, hydrating from disk if it's
 * the first access since boot. Synchronous return, but the disk read is
 * async — clients calling getDraft() right after server boot may see an
 * empty state momentarily before a snapshot.flush() updates them.
 *
 * Use {@link getDraftReady} when you need to await hydration.
 */
export function getDraft(sessionId: string): Draft {
  let d = drafts.get(sessionId);
  if (!d) {
    d = new Draft(sessionId);
    drafts.set(sessionId, d);
    // Fire-and-forget hydrate; subsequent reads will see the loaded state.
    const p = d.hydrateFromDisk().then(() => {
      // Push a snapshot to any listener that already connected during hydrate.
      d!.emit(d!.snapshot());
    });
    hydrating.set(sessionId, p);
    p.finally(() => hydrating.delete(sessionId));
  }
  return d;
}

/** Awaits hydration before returning. Used in REST handlers where we need a
 *  consistent read (e.g. publish, GET /draft). */
export async function getDraftReady(sessionId: string): Promise<Draft> {
  const d = getDraft(sessionId);
  const p = hydrating.get(sessionId);
  if (p) await p;
  return d;
}

export function dropDraft(sessionId: string) {
  const d = drafts.get(sessionId);
  if (d) {
    void d.flush().catch(() => {});
    drafts.delete(sessionId);
  }
}

/** Test helper — wipes the in-memory cache. Disk is untouched. */
export function _resetForTests() {
  drafts.clear();
  hydrating.clear();
  ensuredDirs.clear();
}
