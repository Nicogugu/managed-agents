import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createSession,
  sendMessage,
  publishDraft,
  fetchHealth,
} from "./api";

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
        body: JSON.stringify({ text: "hello" }),
      }),
    );
  });
});

describe("publishDraft", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to /api/wp/posts for create", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await publishDraft({ action: "create", title: "x" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/wp/posts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ title: "x" });
  });

  it("PUTs to /api/wp/posts/:id for update", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await publishDraft({ action: "update", id: 9, title: "x" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/wp/posts/9");
    expect(init.method).toBe("PUT");
  });

  it("throws if update has no id", async () => {
    await expect(publishDraft({ action: "update", title: "x" } as any)).rejects.toThrow(
      /update requires id/,
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
