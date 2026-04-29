import { test, expect, type Page } from "@playwright/test";

/**
 * Reproduction of the user-reported bug:
 *   1. open editor → blocks visible
 *   2. close editor
 *   3. agent inserts more blocks
 *   4. reopen editor → expected: ALL blocks visible (old + new)
 *
 * The fix keeps the BlockNote instance + the SSE consumer mounted across
 * close/open cycles, so events that arrive while "closed" still apply.
 */

const seedEmptyDraft = JSON.stringify({
  type: "draft.snapshot",
  blocks: [],
  meta: {
    title: "",
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
});

async function setupMocks(page: Page) {
  // Catch-all /api mock — match what the prod app calls.
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (body: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const sse = (body: string) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-accel-buffering": "no",
        },
        body,
      });

    if (path === "/api/health")
      return json({ ok: true, anthropicKey: true, wpConfigured: true });
    if (path === "/api/sessions" && method === "POST")
      return json({ id: "sess_persist", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path) && method === "GET")
      return json({ id: "sess_persist", title: "test" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/message$/.test(path)) return json({ ok: true });
    if (/^\/api\/sessions\/[^/]+\/draft\/meta$/.test(path)) return json({});
    return json({ error: "unhandled" }, 501);
  });

  // FakeES that buffers listeners per URL and lets tests push events.
  await page.context().addInitScript(() => {
    const buses = new Map<string, Set<(d: string) => void>>();
    class FakeES extends EventTarget {
      url: string;
      readyState = 1;
      onopen: any = null;
      onerror: any = null;
      onmessage: any = null;
      private listener: (d: string) => void;
      constructor(url: string) {
        super();
        this.url = url;
        const set = buses.get(url) || new Set();
        buses.set(url, set);
        this.listener = (data) => {
          if (this.readyState !== 1) return;
          const e = new MessageEvent("message", { data });
          this.onmessage?.(e);
          this.dispatchEvent(e);
        };
        set.add(this.listener);
        queueMicrotask(() => this.onopen?.({}));
      }
      close() {
        this.readyState = 2;
        buses.get(this.url)?.delete(this.listener);
      }
    }
    (window as any).EventSource = FakeES;
    (window as any).__pushSSE = (urlPattern: string, payload: any) => {
      const data = typeof payload === "string" ? payload : JSON.stringify(payload);
      for (const [url, set] of buses) {
        if (url.includes(urlPattern)) set.forEach((fn) => fn(data));
      }
    };
  });
}

async function pushDraftOp(page: Page, op: any) {
  await page.evaluate(
    ([pattern, op]) => (window as any).__pushSSE(pattern, { type: "draft.op", op }),
    ["/draft/stream", op] as const,
  );
}

test.describe("editor stay-mounted across open/close", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test("blocks inserted while closed are visible on reopen", async ({ page }) => {
    await page.goto("/");

    // Wait for the empty-state starters to render
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });

    // 1. Open editor
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    // 2. Push a first block while editor is open
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "h1", type: "heading", content: "Titre", props: { level: 1 } },
    });
    await expect(page.locator('.bn-block[data-id="h1"]')).toContainText("Titre");

    // 3. Close the editor
    await page.getByRole("button", { name: "Fermer l'éditeur" }).click();
    await expect(page.locator(".bn-editor")).not.toBeVisible();

    // 4. Push more blocks while editor is closed
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: "h1",
      block: { id: "p1", type: "paragraph", content: "premier paragraphe" },
    });
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: "p1",
      block: { id: "p2", type: "paragraph", content: "deuxième paragraphe" },
    });

    // 5. Reopen the editor — both old (h1) AND new (p1, p2) blocks must be present.
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.bn-block[data-id="h1"]')).toContainText("Titre");
    await expect(page.locator('.bn-block[data-id="p1"]')).toContainText("premier paragraphe");
    await expect(page.locator('.bn-block[data-id="p2"]')).toContainText("deuxième paragraphe");
  });

  test("editor handle stays alive: blocks_append_text streams while closed", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Insert an empty paragraph then close
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "stream1", type: "paragraph", content: "" },
    });
    await page.getByRole("button", { name: "Fermer l'éditeur" }).click();

    // Stream tokens into the block while closed
    for (const chunk of ["Le ", "café ", "italien"]) {
      await pushDraftOp(page, { op: "block_append_text", id: "stream1", delta: chunk });
    }

    // Reopen — content should be there
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator('.bn-block[data-id="stream1"]')).toContainText(
      "Le café italien",
      { timeout: 5_000 },
    );
  });
});
