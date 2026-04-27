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

async function setupMocks(page: Page) {
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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
    if (path === "/api/health")
      return json({ ok: true, anthropicKey: true, wpConfigured: true });
    if (path === "/api/sessions")
      return json({ id: "sess_cb", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path)) return json({ id: "sess_cb" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
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

async function pushDraftOp(page: Page, op: any) {
  await page.evaluate(
    ([pattern, op]) =>
      (window as any).__pushSSE(pattern, { type: "draft.op", op }),
    ["/draft/stream", op] as const,
  );
}

test.describe("Client custom blocks (Superprof)", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test("agent-inserted superprof/quote-block renders with descriptor", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: {
        id: "cb1",
        type: "client_block",
        props: {
          instance: {
            namespace: "superprof/quote-block",
            attrs: { quote: "Le test", citation: "PM" },
          },
        },
      },
    });

    // The custom block header shows the descriptor label + namespace
    await expect(page.getByText("Citation Superprof").first()).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("superprof/quote-block").first()).toBeVisible();

    // The render lambda of the descriptor produces a real <blockquote>
    await expect(
      page.locator(".client-block__preview blockquote.wp-block-superprof-quote-block"),
    ).toContainText("Le test");
  });

  test("clicking 'Modifier' opens the auto-generated edit form", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: {
        id: "cb2",
        type: "client_block",
        props: {
          instance: {
            namespace: "superprof/quote-block",
            attrs: { quote: "Original", citation: "Anon" },
          },
        },
      },
    });

    await page.getByRole("button", { name: /Modifier/ }).first().click();

    // Fields auto-built from descriptor.attrs
    const quote = page.locator(".client-block__form textarea").first();
    await expect(quote).toHaveValue("Original");
    await quote.fill("Modifié");

    // Switch back to preview
    await page.getByRole("button", { name: /Terminé/ }).first().click();
    await expect(page.locator(".client-block__preview p").first()).toContainText(
      "Modifié",
    );
  });

  test("polls-block renders children list and allows add/remove", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: {
        id: "cb3",
        type: "client_block",
        props: {
          instance: {
            namespace: "superprof/polls-block",
            attrs: { pollId: "p1", pollQuestion: "Quoi ?" },
            children: [
              { attrs: { choiceId: "c1", choiceIndex: 0, choiceText: "A" } },
              { attrs: { choiceId: "c2", choiceIndex: 1, choiceText: "B" } },
            ],
          },
        },
      },
    });

    await expect(page.getByText("Sondage Superprof").first()).toBeVisible();
    // Preview lists the children
    await expect(page.locator(".client-block__preview li").first()).toContainText(
      "A",
    );
    await expect(page.locator(".client-block__preview li").nth(1)).toContainText(
      "B",
    );

    // Open edit + add a child
    await page.getByRole("button", { name: /Modifier/ }).first().click();
    await page.getByRole("button", { name: /\+ Option/ }).click();
    // Now there should be 3 children rows in the form
    const childRows = page.locator(".client-block__child");
    await expect(childRows).toHaveCount(3);
  });
});
