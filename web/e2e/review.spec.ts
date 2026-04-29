import { test, expect, type Page } from "@playwright/test";

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

interface MockState {
  reviewStarts: Array<{ kinds: string[] }>;
}

async function setupMocks(page: Page, state: MockState) {
  await page.context().route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (body: any) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
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

    if (path === "/api/health") return json({ ok: true, anthropicKey: true, wpConfigured: true });
    if (path === "/api/sessions" && method === "POST")
      return json({ id: "sess_rev", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path)) return json({ id: "sess_rev" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/review\/stream$/.test(path))
      return sse(
        `data: ${JSON.stringify({
          type: "review.batch_finished",
          content_hash: "",
          results: {},
        })}\n\n`,
      );
    if (/^\/api\/sessions\/[^/]+\/draft\/review\/start$/.test(path)) {
      state.reviewStarts.push(JSON.parse(req.postData() || "{}"));
      return json({ content_hash: "abc", cached: false });
    }
    return json({});
  });
  await page.context().addInitScript(() => {
    const buses = new Map<string, Set<(d: string) => void>>();
    class FakeES extends EventTarget {
      url: string;
      readyState = 1;
      onopen: any = null;
      onmessage: any = null;
      onerror: any = null;
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

test.describe("Pre-publish review", () => {
  test("renders the 4 trigger buttons + 3 reviewer rows", async ({ page }) => {
    const state: MockState = { reviewStarts: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText("Review pré-publication")).toBeVisible();
    await expect(page.getByRole("button", { name: /⚖️ Légal$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /🔍 Fact-check$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /🔗 Liens internes$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /✨ Tous/ })).toBeVisible();
  });

  test("clicking a single reviewer button POSTs that kind", async ({ page }) => {
    const state: MockState = { reviewStarts: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    await page.getByRole("button", { name: /⚖️ Légal$/ }).click();
    await expect.poll(() => state.reviewStarts.length).toBe(1);
    expect(state.reviewStarts[0].kinds).toEqual(["legal"]);
  });

  test('clicking "Tous" POSTs all three kinds', async ({ page }) => {
    const state: MockState = { reviewStarts: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    await page.getByRole("button", { name: /✨ Tous/ }).click();
    await expect.poll(() => state.reviewStarts.length).toBe(1);
    expect(new Set(state.reviewStarts[0].kinds)).toEqual(
      new Set(["legal", "fact", "links"]),
    );
  });

  test("shows running spinner then findings on SSE update", async ({ page }) => {
    const state: MockState = { reviewStarts: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Trigger a review
    await page.getByRole("button", { name: /⚖️ Légal$/ }).click();

    // Push the running state via SSE
    await page.evaluate(() =>
      (window as any).__pushSSE("/draft/review/stream", {
        type: "review.kind_started",
        kind: "legal",
        status: { state: "running", started_at: Date.now() },
      }),
    );
    await expect(page.getByText(/Analyse…/)).toBeVisible({ timeout: 3000 });

    // Push the finished state with one warning
    await page.evaluate(() =>
      (window as any).__pushSSE("/draft/review/stream", {
        type: "review.kind_finished",
        kind: "legal",
        status: {
          state: "warned",
          findings: [
            {
              severity: "warn",
              message: "Possible claim non sourcé",
              suggestion: "Ajouter une source",
            },
          ],
          finished_at: Date.now(),
          duration_ms: 1000,
        },
      }),
    );
    await expect(page.getByText(/⚠️ 1$/)).toBeVisible();

    // Click the row (the one with the ▸ chevron) to expand findings
    await page.getByRole("button", { name: /Légal.*▸/ }).click();
    await expect(page.getByText("Possible claim non sourcé")).toBeVisible();
    await expect(page.getByText("Ajouter une source")).toBeVisible();
  });
});
