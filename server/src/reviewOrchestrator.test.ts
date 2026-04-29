import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "review-test-"));
  process.env.DRAFT_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.DRAFT_DIR;
  vi.restoreAllMocks();
});

describe("reviewOrchestrator", () => {
  it("returns cached:true when re-run on the same content with terminal results", async () => {
    const { startReviewBatch } = await import("./reviewOrchestrator.js");
    const { getDraftReady } = await import("./draftStore.js");
    const draft = await getDraftReady("sess_cache");
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "b1", type: "paragraph", content: "Hello" } as any,
    });

    // Mock the orchestrator's two reviewer paths so it doesn't hit Anthropic.
    // For this test we don't actually need to verify the run — we just want
    // to seed the snapshot with terminal results and confirm the cache short-circuits.
    const { getReviewSnapshot } = await import("./reviewOrchestrator.js");
    const snapshot = getReviewSnapshot("sess_cache");
    // Manually set the snapshot as if a previous run completed
    (snapshot as any).content_hash = await computeHashFromDraft();
    (snapshot.results as any).legal = {
      state: "passed",
      findings: [],
      finished_at: Date.now(),
      duration_ms: 100,
    };

    const r = await startReviewBatch("sess_cache", ["legal"]);
    expect(r.cached).toBe(true);
    expect(r.content_hash).toBe(snapshot.content_hash);
  });

  it("returns cached:false on first run", async () => {
    const { startReviewBatch } = await import("./reviewOrchestrator.js");
    const { getDraftReady } = await import("./draftStore.js");
    const draft = await getDraftReady("sess_fresh");
    draft.apply({
      op: "block_insert",
      after_id: null,
      block: { id: "b1", type: "paragraph", content: "fresh" } as any,
    });
    // Stub out actual reviewer execution by mocking the module that creates
    // sessions — but for a smoke test we only validate the synchronous
    // cache-decision path; the async fan-out fires in the background.
    vi.spyOn(
      await import("./reviewers.js"),
      "getOrCreateReviewerAgent",
    ).mockImplementation(async () => "fake_agent");
    vi.spyOn(
      await import("./anthropic.js"),
      "getOrCreateEnvironment",
    ).mockImplementation(async () => "fake_env");
    // Sessions.create will be called by runOneReview — we don't await its
    // result, just verify cached:false comes back synchronously.
    const r = await startReviewBatch("sess_fresh", ["legal"]);
    expect(r.cached).toBe(false);
    expect(r.content_hash).toMatch(/^[a-f0-9]+$/);
  });
});

async function computeHashFromDraft() {
  const { getDraftReady } = await import("./draftStore.js");
  const draft = await getDraftReady("sess_cache");
  // Reproduce hashContent shape (sha256 over blocks + meta minus modified_gmt)
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  h.update(JSON.stringify(draft.state.blocks));
  h.update("|");
  const { modified_gmt: _drop, ...meta } = draft.state.meta as any;
  h.update(JSON.stringify(meta));
  return h.digest("hex").slice(0, 16);
}
