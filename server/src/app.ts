import express, { type Express } from "express";
import cors from "cors";
import { client, createSession } from "./anthropic.js";
import {
  createPost,
  updatePost,
  listPosts,
  getPost,
  listCategories,
  listTags,
  listMedia,
  uploadMedia,
  type WpPostInput,
} from "./wordpress.js";
import { generateImage, slugifyForFilename } from "./nanobanana.js";

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      wpConfigured: Boolean(
        process.env.WP_BASE_URL &&
          process.env.WP_USER &&
          process.env.WP_APP_PASSWORD,
      ),
    });
  });

  app.post("/api/sessions", async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: "ANTHROPIC_API_KEY missing",
        detail: "Add your key to server/.env then save (tsx watch will reload).",
      });
    }
    try {
      const title = (req.body?.title as string) || "Chat session";
      const session = await createSession(title);
      res.json({ id: session.id, title: session.title });
    } catch (err: any) {
      console.error("[sessions] create error:", err);
      const status = err?.status || 500;
      res.status(status).json({
        error: err?.message || "createSession failed",
        detail: err?.error?.error?.message || err?.error?.message,
      });
    }
  });

  app.post("/api/sessions/:id/message", async (req, res) => {
    try {
      const { id } = req.params;
      const text = (req.body?.text as string)?.trim();
      if (!text) return res.status(400).json({ error: "text required" });

      await client.beta.sessions.events.send(id, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }],
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sessions/:id/interrupt", async (req, res) => {
    try {
      const { id } = req.params;
      await client.beta.sessions.events.send(id, {
        events: [{ type: "user.interrupt" } as any],
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sessions/:id/stream", async (req, res) => {
    const { id } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    // Heartbeat toutes les 15s pour empêcher les proxies (Traefik, etc.)
    // de couper la connexion idle.
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(": ping\n\n");
    }, 15000);

    try {
      const stream = await client.beta.sessions.events.stream(id);
      for await (const event of stream as any) {
        if (closed) break;
        send(event);
      }
    } catch (err: any) {
      console.error("[stream] error:", err);
      if (!closed) send({ type: "error", message: err.message });
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  });

  app.get("/api/wp/posts", async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      const perPage = req.query.per_page
        ? Number(req.query.per_page)
        : undefined;
      const search = (req.query.search as string) || undefined;
      const posts = await listPosts({ status, per_page: perPage, search });
      res.json({ posts });
    } catch (err: any) {
      console.error("[wp] list error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wp/posts/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await getPost(id);
      res.json(post);
    } catch (err: any) {
      console.error("[wp] get error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wp/categories", async (_req, res) => {
    try {
      res.json({ categories: await listCategories() });
    } catch (err: any) {
      console.error("[wp] categories error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wp/tags", async (req, res) => {
    try {
      const search = (req.query.search as string) || undefined;
      res.json({ tags: await listTags(search) });
    } catch (err: any) {
      console.error("[wp] tags error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wp/media", async (req, res) => {
    try {
      const perPage = req.query.per_page ? Number(req.query.per_page) : 20;
      res.json({ media: await listMedia(perPage) });
    } catch (err: any) {
      console.error("[wp] media error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Image generation: prompt -> Nano Banana -> upload WP Media -> renvoie {id, url}
  app.post("/api/image", async (req, res) => {
    try {
      const prompt = (req.body?.prompt as string)?.trim();
      const altText = (req.body?.alt_text as string) || "";
      const title = (req.body?.title as string) || "";
      const aspectRatio = req.body?.aspect_ratio as any;
      const imageSize = req.body?.image_size as any;
      if (!prompt) return res.status(400).json({ error: "prompt required" });

      console.log(`[image] generate "${prompt.slice(0, 80)}..."`);
      const img = await generateImage({ prompt, aspectRatio, imageSize });
      const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
      const filename = `${slugifyForFilename(title || prompt) || "agent-image"}.${ext}`;

      const media = await uploadMedia({
        data: img.data,
        filename,
        mimeType: img.mimeType,
        altText: altText || prompt.slice(0, 200),
        title: title || filename.replace(/\.[^.]+$/, ""),
      });
      console.log(`[image] uploaded media ${media.id} ${media.source_url}`);
      res.json({
        id: media.id,
        url: media.source_url,
        alt_text: media.alt_text,
        mime_type: media.mime_type,
      });
    } catch (err: any) {
      console.error("[image] error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/wp/posts", async (req, res) => {
    try {
      const post = await createPost(req.body as WpPostInput);
      res.json(post);
    } catch (err: any) {
      console.error("[wp] create error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/wp/posts/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await updatePost(id, req.body as WpPostInput);
      res.json(post);
    } catch (err: any) {
      console.error("[wp] update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
