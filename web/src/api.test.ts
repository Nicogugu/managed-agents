import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createSession, sendMessage, fetchHealth } from "./api";

describe("createSession", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the session id on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "sess_1", title: "x" }),
      }),
    );
    const id = await createSession("x");
    expect(id).toBe("sess_1");
  });

  it("surfaces structured error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          error: "ANTHROPIC_API_KEY missing",
          detail: "Add it to server/.env",
        }),
      }),
    );
    await expect(createSession()).rejects.toThrow(
      /503.*ANTHROPIC_API_KEY missing.*Add it/,
    );
  });
});

describe("sendMessage", () => {
  it("posts to /api/sessions/:id/message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await sendMessage("sess_1", "hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/sess_1/message",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "hello", selection_block_ids: [] }),
      }),
    );
  });
});

describe("fetchHealth", () => {
  it("returns the health payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, anthropicKey: true, wpConfigured: true }),
      }),
    );
    const h = await fetchHealth();
    expect(h.anthropicKey).toBe(true);
    expect(h.wpConfigured).toBe(true);
  });
});
