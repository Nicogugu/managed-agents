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
      return json({ id: "sess_lscape", title: "test" });
    if (/^\/api\/sessions\/[^/]+$/.test(path)) return json({ id: "sess_lscape" });
    if (/^\/api\/sessions\/[^/]+\/stream$/.test(path))
      return sse(`data: ${JSON.stringify({ type: "session.status_idle" })}\n\n`);
    if (/^\/api\/sessions\/[^/]+\/draft\/stream$/.test(path))
      return sse(`data: ${seedEmptyDraft}\n\n`);
    return json({}, 200);
  });
}

test.describe("split layout on landscape phones", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  // Phone landscape: Pixel 7 ≈ 915×412, iPhone 14 Pro ≈ 852×393. Both
  // fall within 768-1023px, so md: applies, lg: doesn't.
  test("phone landscape (852x393) splits chat + editor side-by-side", async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });

    // Open editor
    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    // The chat should still be visible in a narrow column on its left
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible();

    // Editor occupies the right side, with usable width (>=200 visible)
    const editorBox = await page.locator(".bn-editor").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.width).toBeGreaterThan(200);

    // Chat column is to the left of the editor column
    const chatBox = await page
      .getByText(/Propose-moi 5 idées/)
      .first()
      .boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBox!.x).toBeLessThan(editorBox!.x);
  });

  // Phone portrait: 412×915 — chat full-width when closed, fully hidden
  // when editor is open (editor takes whole screen).
  test("phone portrait (412x915) hides chat when editor opens", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/");
    await expect(page.getByText(/Propose-moi 5 idées/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Ouvrir l'éditeur de blocs/ }).click();
    await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5_000 });

    // The chat empty state is now hidden (display: none under the editor)
    await expect(page.getByText(/Propose-moi 5 idées/).first()).not.toBeVisible();

    // Editor takes the full width (chat is hidden so editor fills viewport
    // minus its own gutters/padding — at 412px viewport, content area is
    // ~280px which is enough to be usable).
    const editorBox = await page.locator(".bn-editor").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.width).toBeGreaterThan(200);
  });
});
