import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("./anthropic.js", () => ({
  client: {
    beta: {
      sessions: {
        events: {
          send: vi.fn().mockResolvedValue({}),
          stream: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {
              yield { type: "session.status_idle" };
            },
          }),
        },
      },
    },
  },
  createSession: vi.fn(),
}));

import { createApp } from "./app.js";
import * as anthropic from "./anthropic.js";

describe("GET /api/health", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.WP_BASE_URL;
    delete process.env.WP_USER;
    delete process.env.WP_APP_PASSWORD;
  });

  it("reports config flags", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      anthropicKey: false,
      wpConfigured: false,
    });
  });

  it("reports keys present when env is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.WP_BASE_URL = "https://wp.example";
    process.env.WP_USER = "u";
    process.env.WP_APP_PASSWORD = "p";
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.body).toEqual({
      ok: true,
      anthropicKey: true,
      wpConfigured: true,
    });
  });
});

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 with helpful detail when key missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const app = createApp();
    const res = await request(app).post("/api/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("ANTHROPIC_API_KEY");
    expect(res.body.detail).toContain("server/.env");
  });

  it("creates a session when key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    (anthropic.createSession as any).mockResolvedValueOnce({
      id: "sess_123",
      title: "x",
    });
    const app = createApp();
    const res = await request(app)
      .post("/api/sessions")
      .send({ title: "x" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "sess_123", title: "x" });
  });

  it("propagates SDK error status when present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const err: any = new Error("rate limited");
    err.status = 429;
    (anthropic.createSession as any).mockRejectedValueOnce(err);
    const app = createApp();
    const res = await request(app).post("/api/sessions").send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate limited");
  });
});

describe("POST /api/sessions/:id/message", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty text", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/sessions/abc/message")
      .send({ text: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("text required");
  });

  it("forwards user message via SDK", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/sessions/sess_1/message")
      .send({ text: "hello" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(anthropic.client.beta.sessions.events.send).toHaveBeenCalledWith(
      "sess_1",
      {
        events: [
          { type: "user.message", content: [{ type: "text", text: "hello" }] },
        ],
      },
    );
  });
});
