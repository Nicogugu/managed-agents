import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { getDraftReady, _resetForTests } from "./draftStore.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "drafts-test-"));
  process.env.DRAFT_DIR = tmpDir;
  _resetForTests();
});

afterEach(async () => {
  _resetForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.DRAFT_DIR;
});

describe("draftStore persistence", () => {
  it("hydrates from disk on first access", async () => {
    const sid = "sess_hydrate";
    const file = path.join(tmpDir, `${sid}.json`);
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        saved_at: new Date().toISOString(),
        state: {
          blocks: [{ id: "b1", type: "paragraph", content: "ohai" }],
          meta: {
            title: "Restored",
            slug: "",
            excerpt: "",
            status: "draft",
            categories: [],
            tags: [],
            featured_media: null,
            featured_media_url: null,
            seo: {},
          },
          original: null,
        },
      }),
      "utf8",
    );

    const draft = await getDraftReady(sid);
    expect(draft.state.blocks).toHaveLength(1);
    expect(draft.state.blocks[0].id).toBe("b1");
    expect(draft.state.meta.title).toBe("Restored");
  });

  it("flushes a mutation to disk after a debounce", async () => {
    const sid = "sess_flush";
    const draft = await getDraftReady(sid);
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "h1", type: "heading", content: "Hello" } as any,
    });
    await new Promise((r) => setTimeout(r, 700));
    const file = path.join(tmpDir, `${sid}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.state.blocks).toHaveLength(1);
    expect(parsed.state.blocks[0].content).toBe("Hello");
  });

  it("explicit flush() writes immediately and idempotently", async () => {
    const sid = "sess_immediate";
    const draft = await getDraftReady(sid);
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "p1", type: "paragraph", content: "x" } as any,
    });
    await draft.flush();
    const file = path.join(tmpDir, `${sid}.json`);
    const raw1 = await fs.readFile(file, "utf8");
    await draft.flush();
    const raw2 = await fs.readFile(file, "utf8");
    expect(raw1).toBe(raw2);
  });

  it("survives a simulated server restart", async () => {
    const sid = "sess_restart";
    const draft = await getDraftReady(sid);
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "k", type: "paragraph", content: "kept" } as any,
    });
    await draft.flush();

    // Wipe in-memory cache (simulates a server restart, same DRAFT_DIR)
    _resetForTests();
    const reloaded = await getDraftReady(sid);
    expect(reloaded.state.blocks.find((b: any) => b.id === "k")).toBeTruthy();
  });

  it("rejects path traversal in sessionId", async () => {
    const sid = "../escape";
    const draft = await getDraftReady(sid);
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "x", type: "paragraph", content: "evil" } as any,
    });
    await draft.flush();
    // Sanitised filename: "../escape" → "___escape" (`.` and `/` → `_`)
    const sanitised = path.join(tmpDir, "___escape.json");
    const stat = await fs.stat(sanitised);
    expect(stat.isFile()).toBe(true);
    const escapeFile = path.join(path.dirname(tmpDir), "escape.json");
    await expect(fs.stat(escapeFile)).rejects.toThrow();
  });
});
