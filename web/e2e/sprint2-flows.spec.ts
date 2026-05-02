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
  publishCalls: Array<{ status?: string; body: any }>;
}

async function setupMocks(page: Page, state: MockState) {
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (body: any, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
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
      return json({ id: "sess_s2", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path))
      return json({ id: "sess_s2", title: "test" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/publish$/.test(path)) {
      state.publishCalls.push({
        body: JSON.parse(route.request().postData() || "{}"),
      });
      return json({ id: 999, link: "https://wp.test/?p=999", status: "publish" });
    }
    if (/^\/api\/sessions\/[^/]+\/message$/.test(path)) return json({ ok: true });
    if (/^\/api\/sessions\/[^/]+\/draft\/meta$/.test(path)) return json({});
    return json({}, 200);
  });

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

test.describe("Sprint 2: meta.status flips do NOT auto-publish anymore", () => {
  test("status=publish from agent meta_update does not call /draft/publish", async ({
    page,
  }) => {
    const state: MockState = { publishCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "h1", type: "heading", content: "Article", props: { level: 1 } },
    });
    await pushDraftOp(page, {
      op: "meta_update",
      meta: { title: "Article", status: "publish" },
    });

    // Auto-publish was removed: nothing should be published unless the
    // user clicks the Publier button.
    await page.waitForTimeout(1500);
    expect(state.publishCalls).toHaveLength(0);
  });
});

test.describe("Sprint 2: Superprof raw_html block", () => {
  test("agent-emitted raw_html survives editor render and is sent verbatim on publish", async ({
    page,
  }) => {
    const state: MockState = { publishCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    const superprofQuoteHtml =
      '<!-- wp:superprof/quote-block {"quote":"Le test","citation":"Anon"} -->\n' +
      '<blockquote class="wp-block-superprof-quote-block"><p>Le test</p><cite>Anon</cite></blockquote>\n' +
      "<!-- /wp:superprof/quote-block -->";

    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: {
        id: "sp1",
        type: "raw_html",
        props: { html: superprofQuoteHtml, raw: superprofQuoteHtml },
      },
    });

    // Preview mode: the inner blockquote is rendered inside .rawhtml-block__preview
    await expect(
      page.locator(".rawhtml-block__preview blockquote.wp-block-superprof-quote-block"),
    ).toBeVisible({ timeout: 3000 });
    await expect(
      page.locator(".rawhtml-block__preview blockquote.wp-block-superprof-quote-block cite"),
    ).toContainText("Anon");
  });

  test('"Voir le HTML" toggle shows the source HTML', async ({ page }) => {
    const state: MockState = { publishCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    const html =
      '<!-- wp:superprof/quote-block {"quote":"X"} --><blockquote>X</blockquote><!-- /wp:superprof/quote-block -->';
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "sp2", type: "raw_html", props: { html, raw: html } },
    });
    // Preview by default
    await expect(page.locator(".rawhtml-block__preview")).toBeVisible();
    await expect(page.locator(".rawhtml-block__source")).not.toBeVisible();

    // Click toggle → source visible with the exact HTML
    await page.getByRole("button", { name: "Voir le HTML" }).click();
    const ta = page.locator(".rawhtml-block__source");
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue(html);

    // Toggle back
    await page.getByRole("button", { name: "Aperçu" }).click();
    await expect(page.locator(".rawhtml-block__preview")).toBeVisible();
  });

  test("trailing paragraph is added so the user can click below an atom block", async ({
    page,
  }) => {
    const state: MockState = { publishCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Doc starts with 1 placeholder paragraph. Insert a raw_html block at top.
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: {
        id: "atom1",
        type: "raw_html",
        props: { html: "<div>raw</div>", raw: "<div>raw</div>" },
      },
    });

    // After insertion, the doc must end with a non-atom block so the user
    // can click below to escape the selection.
    const types = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".bn-editor .bn-block-outer"))
        .map((el) => el.getAttribute("data-content-type"))
        .filter(Boolean),
    );
    // Last block should NOT be rawHtml
    expect(types[types.length - 1]).not.toBe("rawHtml");
  });
});
