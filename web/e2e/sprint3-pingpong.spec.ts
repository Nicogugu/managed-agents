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
  messageCalls: Array<{ text: string; selection_block_ids: string[] }>;
  blockFlushCalls: Array<{ blocks: any[] }>;
  undoCalls: number;
  lockCalls: Array<{ blockId: string; locked: boolean }>;
}

async function setupMocks(page: Page, state: MockState) {
  await page.context().route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
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
      return json({ id: "sess_s3", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path))
      return json({ id: "sess_s3", title: "test" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/message$/.test(path)) {
      const body = JSON.parse(req.postData() || "{}");
      state.messageCalls.push({
        text: body.text,
        selection_block_ids: body.selection_block_ids || [],
      });
      return json({ ok: true });
    }
    if (/^\/api\/sessions\/[^/]+\/draft\/blocks$/.test(path)) {
      const body = JSON.parse(req.postData() || "{}");
      state.blockFlushCalls.push({ blocks: body.blocks || [] });
      return json({ ok: true });
    }
    if (/^\/api\/sessions\/[^/]+\/draft\/undo$/.test(path)) {
      state.undoCalls++;
      return json({ ok: true });
    }
    const lockMatch = path.match(
      /^\/api\/sessions\/[^/]+\/draft\/blocks\/([^/]+)\/lock$/,
    );
    if (lockMatch) {
      const body = JSON.parse(req.postData() || "{}");
      state.lockCalls.push({
        blockId: lockMatch[1],
        locked: Boolean(body.locked),
      });
      return json({ ok: true, locked: body.locked });
    }
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

test.describe("Sprint 3: ping-pong agent ↔ user", () => {
  test("agent ops do NOT trigger a user-edit flush back to server", async ({ page }) => {
    // Critical correctness: when the agent inserts a block via SSE, we
    // must NOT flush those blocks back to /draft/blocks (the server would
    // mark them as user_edited in DOC_STATE, polluting agent context).
    const state: MockState = { messageCalls: [], blockFlushCalls: [], undoCalls: 0, lockCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    // Wait past the editor mount grace period
    await page.waitForTimeout(1700);

    // Push 3 agent block_inserts via SSE
    for (let i = 0; i < 3; i++) {
      await pushDraftOp(page, {
        op: "block_insert",
        after_id: null,
        block: { id: `agent_${i}`, type: "paragraph", content: `agent-emit-${i}` },
      });
    }

    // Give the debounce 2s to potentially fire (it shouldn't)
    await page.waitForTimeout(2000);
    expect(state.blockFlushCalls).toHaveLength(0);
  });

  test("quick action button sends sendMessage with selection.block_ids", async ({ page }) => {
    const state: MockState = { messageCalls: [], blockFlushCalls: [], undoCalls: 0, lockCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Seed a paragraph and click into it so a selection block_id exists.
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "para1", type: "paragraph", content: "À reformuler" },
    });
    await page.locator('.bn-block[data-id="para1"]').click();

    // Quick actions bar should now be visible
    await expect(page.getByText(/Bloc sélectionné/)).toBeVisible({ timeout: 3000 });

    // Click "Reformuler" → sendMessage called with selection_block_ids: ["para1"]
    await page.getByRole("button", { name: /Reformuler/ }).first().click();

    await expect.poll(() => state.messageCalls.length, { timeout: 3000 }).toBeGreaterThan(0);
    const lastMsg = state.messageCalls.at(-1)!;
    expect(lastMsg.text).toMatch(/Reformule/);
    expect(lastMsg.selection_block_ids).toEqual(["para1"]);
  });

  test("'Annuler agent' button calls /draft/undo", async ({ page }) => {
    const state: MockState = { messageCalls: [], blockFlushCalls: [], undoCalls: 0, lockCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    await page.getByRole("button", { name: /Annuler agent/ }).click();
    await expect.poll(() => state.undoCalls, { timeout: 3000 }).toBe(1);
  });

  test("'🔒 Verrouiller' button calls /draft/blocks/:id/lock with locked=true", async ({
    page,
  }) => {
    const state: MockState = { messageCalls: [], blockFlushCalls: [], undoCalls: 0, lockCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Seed a block + select it
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "lockme", type: "paragraph", content: "Précieux" },
    });
    await page.locator('.bn-block[data-id="lockme"]').click();

    // Click the "Verrouiller" button in the quick actions bar
    await page.getByRole("button", { name: /🔒 Verrouiller/ }).click();
    await expect.poll(() => state.lockCalls.length, { timeout: 3000 }).toBe(1);
    expect(state.lockCalls[0]).toEqual({ blockId: "lockme", locked: true });
  });

  test("normal chat input also passes selection.block_ids in sendMessage", async ({
    page,
  }) => {
    const state: MockState = { messageCalls: [], blockFlushCalls: [], undoCalls: 0, lockCalls: [] };
    await setupMocks(page, state);
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible();

    // Seed + select
    await pushDraftOp(page, {
      op: "block_insert",
      after_id: null,
      block: { id: "p_chat", type: "paragraph", content: "Texte" },
    });
    await page.locator('.bn-block[data-id="p_chat"]').click();

    // Open the free text input ("← Mode boutons" toggle button)
    await page.getByRole("button", { name: /Écrire/ }).click();
    const ta = page.getByPlaceholder(/Écrire à l'agent/);
    await ta.fill("ok mais en plus court");
    await page.keyboard.press("Enter");

    await expect.poll(() => state.messageCalls.length, { timeout: 3000 }).toBeGreaterThan(0);
    const lastMsg = state.messageCalls.at(-1)!;
    expect(lastMsg.text).toBe("ok mais en plus court");
    expect(lastMsg.selection_block_ids).toEqual(["p_chat"]);
  });
});
