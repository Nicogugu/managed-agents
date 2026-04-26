import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

beforeEach(() => {
  process.env.WP_BASE_URL = "https://wp.test";
  process.env.WP_USER = "user";
  process.env.WP_APP_PASSWORD = "pass";
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function freshImport() {
  vi.resetModules();
  return await import("./wordpress.js");
}

describe("createPost", () => {
  it("uses Basic auth and POSTs to /wp-json/wp/v2/posts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 42, link: "https://wp.test/?p=42" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPost } = await freshImport();
    const post = await createPost({
      title: "Hello",
      content: "<p>Hi</p>",
      status: "draft",
    });

    expect(post).toEqual({ id: 42, link: "https://wp.test/?p=42" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://wp.test/wp-json/wp/v2/posts");
    expect(init.method).toBe("POST");
    const expectedAuth =
      "Basic " + Buffer.from("user:pass").toString("base64");
    expect(init.headers.Authorization).toBe(expectedAuth);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      title: "Hello",
      content: "<p>Hi</p>",
      status: "draft",
    });
  });

  it("resolves string tags to ids (existing tag)", async () => {
    const fetchMock = vi
      .fn()
      // search tag "seo" → found
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 7, name: "seo" }],
      })
      // create post
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { createPost } = await freshImport();
    await createPost({ title: "x", tags: ["seo"] });

    const lastCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(lastCall[1].body);
    expect(body.tags).toEqual([7]);
  });

  it("creates missing tag then uses its id", async () => {
    const fetchMock = vi
      .fn()
      // search → empty
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      // create tag
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 99 }) })
      // create post
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 2 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { createPost } = await freshImport();
    await createPost({ title: "x", tags: ["new-tag"] });

    const createTagCall = fetchMock.mock.calls[1];
    expect(createTagCall[0]).toBe("https://wp.test/wp-json/wp/v2/tags");
    expect(createTagCall[1].method).toBe("POST");

    const postCall = fetchMock.mock.calls[2];
    const body = JSON.parse(postCall[1].body);
    expect(body.tags).toEqual([99]);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }),
    );
    const { createPost } = await freshImport();
    await expect(createPost({ title: "x" })).rejects.toThrow(
      /WP create failed/,
    );
  });
});

describe("updatePost", () => {
  it("POSTs to /wp-json/wp/v2/posts/:id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { updatePost } = await freshImport();
    await updatePost(5, { title: "Updated" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://wp.test/wp-json/wp/v2/posts/5");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ title: "Updated" });
  });
});
