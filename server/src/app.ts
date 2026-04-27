import express, { type Express } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { client, createSession } from "./anthropic.js";
import { generateImage, slugifyForFilename } from "./nanobanana.js";
import {
  createPost,
  updatePost,
  listPosts,
  getPost,
  listCategories,
  listTags,
  listMedia,
  uploadMedia,
  uploadMediaFromUrl,
  type WpPostInput,
} from "./wordpress.js";
import { dispatchBlockTool } from "./agentBlockTools.js";
import { getDraft, getDraftReady } from "./draftStore.js";
import { buildDocState } from "./docState.js";
import { blocksToHtml, htmlToBlocks } from "./htmlBlocks.js";
import type { PostMeta } from "./contract.js";

// ---- Cost / usage tracking ----------------------------------------------
// On agrège les tokens consommés via les events span.model_request_end
// d'Anthropic, par jour UTC. Permet d'avoir un budget visible et un kill
// switch optionnel via DAILY_COST_USD_CAP.
type DailyUsage = {
  date: string; // YYYY-MM-DD UTC
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  imageGenerated: number;
  sessions: number;
};
const usageByDay = new Map<string, DailyUsage>();
const todayKey = () => new Date().toISOString().slice(0, 10);
function getUsage(): DailyUsage {
  const k = todayKey();
  let u = usageByDay.get(k);
  if (!u) {
    u = {
      date: k,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      imageGenerated: 0,
      sessions: 0,
    };
    usageByDay.set(k, u);
  }
  return u;
}
function recordModelUsage(usage: any) {
  const u = getUsage();
  u.inputTokens += usage?.input_tokens || 0;
  u.cacheCreationTokens += usage?.cache_creation_input_tokens || 0;
  u.cacheReadTokens += usage?.cache_read_input_tokens || 0;
  u.outputTokens += usage?.output_tokens || 0;
}
// Pricing approximatif Sonnet 4.6 (USD par million de tokens). À ajuster
// si on bascule sur Opus.
const PRICE = {
  input: 3.0 / 1_000_000,
  output: 15.0 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000, // 25% premium sur input
  cacheRead: 0.3 / 1_000_000, // 10% du input
  imagePerCall: 0.024, // Nano Banana Flash 1K ~$0.024
};
function estimateCostUsd(u: DailyUsage): number {
  return (
    u.inputTokens * PRICE.input +
    u.outputTokens * PRICE.output +
    u.cacheCreationTokens * PRICE.cacheWrite +
    u.cacheReadTokens * PRICE.cacheRead +
    u.imageGenerated * PRICE.imagePerCall
  );
}
function isOverBudget(): boolean {
  const cap = parseFloat(process.env.DAILY_COST_USD_CAP || "");
  if (!cap || cap <= 0) return false;
  return estimateCostUsd(getUsage()) >= cap;
}

// ---- Custom tool dispatcher ---------------------------------------------
// Quand l'agent émet `agent.custom_tool_use`, le pump appelle dispatchCustomTool
// qui exécute le tool côté serveur et renvoie `user.custom_tool_result`.
async function dispatchCustomTool(
  sessionId: string,
  ev: any,
): Promise<void> {
  const useId = ev.id;
  const name = ev.name;
  const input = (ev.input || {}) as Record<string, any>;
  let resultText: string;
  let isError = false;

  try {
    // Try the block-ops dispatcher first (returns null if `name` isn't ours).
    const blockResult = await dispatchBlockTool(sessionId, name, input);
    if (blockResult) {
      try {
        await client.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: "user.custom_tool_result",
              custom_tool_use_id: useId,
              is_error: blockResult.is_error || false,
              content: blockResult.content,
            } as any,
          ],
        });
      } catch (err: any) {
        console.error(`[custom-tool] failed to send block result:`, err?.message);
      }
      return;
    }

    if (name === "wp_image_generate") {
      const img = await generateImage({
        prompt: input.prompt,
        aspectRatio: input.aspect_ratio,
        imageSize: input.image_size,
      });
      const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
      const filename = `${slugifyForFilename(input.title || input.prompt) || "agent-image"}.${ext}`;
      const media = await uploadMedia({
        data: img.data,
        filename,
        mimeType: img.mimeType,
        altText: input.alt_text || String(input.prompt).slice(0, 200),
        title: input.title || filename.replace(/\.[^.]+$/, ""),
      });
      resultText = JSON.stringify({
        id: media.id,
        url: media.source_url,
        alt_text: media.alt_text,
        mime_type: media.mime_type,
      });
      getUsage().imageGenerated++;
      console.log(`[custom-tool] wp_image_generate → media #${media.id}`);
    } else if (name === "wp_publish") {
      const action = input.action;
      const { action: _a, id: postId, ...payload } = input;
      // Status par défaut: publish (l'agent ne devrait pas appeler wp_publish
      // sinon — pour les drafts l'agent émet un bloc wp-post)
      const post: any = { status: "publish", ...payload };
      let result: any;
      if (action === "update") {
        if (!postId) throw new Error("update requires id");
        result = await updatePost(Number(postId), post);
      } else {
        result = await createPost(post);
      }
      resultText = JSON.stringify({
        id: result.id,
        link: result.link,
        status: result.status,
        deduped: result._deduped || false,
      });
      console.log(
        `[custom-tool] wp_publish ${action} → #${result.id} ${result.link}`,
      );
    } else {
      resultText = `unknown custom tool: ${name}`;
      isError = true;
    }
  } catch (err: any) {
    resultText = `Error executing ${name}: ${err?.message || err}`;
    isError = true;
    console.error(`[custom-tool] ${name} error:`, err);
  }

  try {
    await client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: useId,
          is_error: isError,
          content: [{ type: "text", text: resultText }],
        } as any,
      ],
    });
  } catch (err: any) {
    console.error(`[custom-tool] failed to send result:`, err?.message);
  }
}

// Buffer d'events par session pour permettre au client de replay tout ce qui
// a été manqué pendant qu'il était hors ligne (téléphone en veille, perte de
// connexion). Le client envoie `Last-Event-ID` à la reconnexion, on lui rejoue
// les events manquants puis on l'attache au stream live.
type BufferedEvent = { id: number; data: unknown };
type StreamState = {
  events: BufferedEvent[];
  // Dédup par event id Anthropic, persiste entre les redémarrages du pump
  // (important quand le stream Anthropic se ferme pour cause d'inactivité et
  // qu'on doit le rouvrir sur la prochaine reconnexion client).
  seenAnthropicIds: Set<string>;
  pumpStarted: boolean;
  pumpEnded: boolean;
  pumpError?: string;
  listeners: Set<(ev: BufferedEvent) => void>;
};
const sessionStreams = new Map<string, StreamState>();
const MAX_BUFFERED_EVENTS = 5000;

function getStreamState(sessionId: string): StreamState {
  let s = sessionStreams.get(sessionId);
  if (!s) {
    s = {
      events: [],
      seenAnthropicIds: new Set(),
      pumpStarted: false,
      pumpEnded: false,
      listeners: new Set(),
    };
    sessionStreams.set(sessionId, s);
  }
  return s;
}

async function startPump(sessionId: string): Promise<void> {
  const state = getStreamState(sessionId);
  if (state.pumpStarted) return;
  state.pumpStarted = true;
  state.pumpEnded = false;
  state.pumpError = undefined;

  // Pendant le backfill on collecte les agent.custom_tool_use et on retire
  // ceux qui ont déjà un user.custom_tool_result. À la fin, ce qui reste
  // est dispatché (cas: server a crashé après avoir reçu use mais avant
  // d'envoyer result). En live stream, dispatch immédiat.
  let inBackfill = true;
  const pendingDispatch = new Map<string, any>();

  const pushEvent = (ev: any) => {
    if (ev?.id && state.seenAnthropicIds.has(ev.id)) return;
    if (ev?.id) state.seenAnthropicIds.add(ev.id);
    const seq = state.events.length + 1;
    const item: BufferedEvent = { id: seq, data: ev };
    state.events.push(item);
    if (state.events.length > MAX_BUFFERED_EVENTS) {
      state.events.splice(0, state.events.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of state.listeners) listener(item);

    if (ev?.type === "agent.custom_tool_use") {
      if (inBackfill) {
        pendingDispatch.set(ev.id, ev);
      } else {
        void dispatchCustomTool(sessionId, ev);
      }
    }
    if (ev?.type === "user.custom_tool_result" && ev.custom_tool_use_id) {
      pendingDispatch.delete(ev.custom_tool_use_id);
    }
    // Cost tracking: on n'agrège que les events live (pas le backfill, qui
    // serait double-comptage si l'agent tourne sur plusieurs containers).
    if (!inBackfill && ev?.type === "span.model_request_end" && ev.model_usage) {
      recordModelUsage(ev.model_usage);
    }
  };

  try {
    // 1. Backfill: replay l'historique complet de la session. Indispensable
    //    après redéploiement du server (events.stream ne renvoie pas le passé)
    //    et après que l'utilisateur a envoyé des messages pendant que la
    //    connexion SSE n'avait pas de pump actif.
    try {
      for await (const ev of (client.beta as any).sessions.events.list(
        sessionId,
        { order: "asc" },
      )) {
        pushEvent(ev);
      }
      console.log(
        `[pump:${sessionId}] backfilled ${state.events.length} past events (${state.seenAnthropicIds.size} unique, ${pendingDispatch.size} unresolved tools)`,
      );
    } catch (err: any) {
      console.warn(`[pump:${sessionId}] backfill failed:`, err?.message);
    }

    inBackfill = false;
    // Dispatch des tools restés sans réponse (server crashé pendant exec)
    for (const [, ev] of pendingDispatch) {
      void dispatchCustomTool(sessionId, ev);
    }
    pendingDispatch.clear();

    // 2. Live stream
    const stream = await client.beta.sessions.events.stream(sessionId);
    for await (const ev of stream as any) {
      pushEvent(ev);
    }
  } catch (err: any) {
    console.error(`[pump:${sessionId}] error:`, err?.message);
    state.pumpError = err?.message || "stream pump error";
  } finally {
    // Pump terminé : Anthropic a fermé le stream ou erreur. On le marque
    // comme terminé MAIS on garde la possibilité de le relancer sur la
    // prochaine reconnexion SSE (le seenAnthropicIds persiste, donc pas de
    // doublons au redémarrage).
    state.pumpStarted = false;
    state.pumpEnded = true;
  }
}

export function createApp(): Express {
  const app = express();
  // Confiance dans le X-Forwarded-For (Traefik est devant), pour que les
  // rate-limit + logs voient les vraies IPs clients et pas celle de Traefik.
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  // Basic Auth gate sur tous les /api sauf /api/health (laissé public pour
  // les health checks externes / smoke tests). Active si AUTH_USER+AUTH_PASS
  // sont set en env. Sinon (dev local) auth désactivée.
  if (process.env.AUTH_USER && process.env.AUTH_PASS) {
    const expectedUser = process.env.AUTH_USER;
    const expectedPass = process.env.AUTH_PASS;
    app.use((req, res, next) => {
      if (req.path === "/api/health" || !req.path.startsWith("/api")) return next();
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Basic ")) {
        res.set("WWW-Authenticate", 'Basic realm="WP Editor"');
        return res.status(401).json({ error: "Auth requise" });
      }
      try {
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
        const sep = decoded.indexOf(":");
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        if (u !== expectedUser || p !== expectedPass) {
          res.set("WWW-Authenticate", 'Basic realm="WP Editor"');
          return res.status(401).json({ error: "Identifiants invalides" });
        }
      } catch {
        return res.status(400).json({ error: "Auth header invalide" });
      }
      next();
    });
  }

  // Rate-limits par IP. Tarés pour un usage 1-utilisateur normal,
  // bloque les abus / boucles infinies / scanners.
  const sessionLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1h
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Trop de sessions créées sur cette heure (max 20/h)." },
  });
  const messageLimit = rateLimit({
    windowMs: 60 * 1000, // 1 min
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Trop de messages envoyés (max 30/min)." },
  });
  const writeLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Trop d'écritures WP (max 10/min)." },
  });

  // Kill switch budget — bloque les nouvelles sessions + messages quand on
  // dépasse DAILY_COST_USD_CAP. Lecture (GET) reste autorisée.
  function budgetGuard(req: any, res: any, next: any) {
    if (isOverBudget()) {
      return res.status(429).json({
        error: "Budget journalier dépassé",
        detail: `Cap = $${process.env.DAILY_COST_USD_CAP}. Coût estimé aujourd'hui = $${estimateCostUsd(getUsage()).toFixed(2)}.`,
      });
    }
    next();
  }

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

  // Stats journalières — utile pour debug coûts. Optionnellement protégeable
  // par token via header X-Admin-Token.
  app.get("/api/admin/stats", (req, res) => {
    const expected = process.env.ADMIN_TOKEN;
    if (expected && req.headers["x-admin-token"] !== expected) {
      return res.status(403).json({ error: "forbidden" });
    }
    const u = getUsage();
    res.json({
      ...u,
      estimatedCostUsd: Number(estimateCostUsd(u).toFixed(4)),
      capUsd: parseFloat(process.env.DAILY_COST_USD_CAP || "0") || null,
      overBudget: isOverBudget(),
    });
  });

  app.post("/api/sessions", sessionLimit, budgetGuard, async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: "ANTHROPIC_API_KEY missing",
        detail: "Add your key to server/.env then save (tsx watch will reload).",
      });
    }
    try {
      const title = (req.body?.title as string) || "Chat session";
      const session = await createSession(title);
      getUsage().sessions++;
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

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await client.beta.sessions.retrieve(req.params.id);
      res.json({ id: session.id, title: (session as any).title });
    } catch (err: any) {
      const status = err?.status || 404;
      res.status(status).json({ error: err?.message || "session not found" });
    }
  });

  app.post("/api/sessions/:id/message", messageLimit, budgetGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const text = (req.body?.text as string)?.trim();
      const selectionBlockIds = Array.isArray(req.body?.selection_block_ids)
        ? (req.body.selection_block_ids as string[])
        : [];
      if (!text) return res.status(400).json({ error: "text required" });

      // Inject the live DOC_STATE so the agent has the current document
      // (blocks, meta, selection, recently-user-edited flags) on every turn.
      // This is the antidote to the "agent works from its own past output"
      // drift problem.
      const draft = await getDraftReady(id);
      const docState = buildDocState(
        draft.state.blocks,
        draft.state.meta,
        draft.state.blockMeta,
        { selectionBlockIds },
      );
      const wrapped = `${docState}\n\n${text}`;

      // Open a new history turn so we can undo every block op the agent
      // emits in response to this user message.
      draft.openTurn();

      await client.beta.sessions.events.send(id, {
        events: [{ type: "user.message", content: [{ type: "text", text: wrapped }] }],
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

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const writeEvent = (id: number, data: unknown, replayed = false) => {
      if (closed) return;
      // _replayed: true sur les events qui sortent du buffer (passé) — le client
      // les insère directement sans typewriter, sinon revivre 50 events serait
      // douloureusement long.
      const enriched = replayed ? { ...(data as object), _replayed: true } : data;
      res.write(`id: ${id}\ndata: ${JSON.stringify(enriched)}\n\n`);
    };

    // Heartbeat toutes les 15s pour empêcher les proxies (Traefik, etc.)
    // de couper la connexion idle.
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(": ping\n\n");
    }, 15000);

    // Last-Event-ID peut venir du header (auto-injecté par EventSource sur reconnect)
    // ou d'un query param ?last_event_id=N (utilisé quand on recrée manuellement
    // l'EventSource après que le browser ait tué la connexion en arrière-plan).
    const lastIdHeader =
      req.headers["last-event-id"] || (req.query.last_event_id as string);
    const lastEventId = lastIdHeader
      ? parseInt(String(lastIdHeader), 10) || 0
      : 0;

    const state = getStreamState(id);

    // 1. Replay des events manqués depuis Last-Event-ID (marqués _replayed)
    for (const ev of state.events) {
      if (ev.id > lastEventId) {
        writeEvent(ev.id, ev.data, true);
      }
    }

    // 2. Tail le stream live: on s'inscrit comme listener
    const listener = (ev: BufferedEvent) => {
      if (closed) return;
      writeEvent(ev.id, ev.data);
    };
    state.listeners.add(listener);

    req.on("close", () => {
      state.listeners.delete(listener);
      clearInterval(heartbeat);
    });

    // 3. Démarre le pump si pas en cours. On le redémarre aussi si pumpEnded
    //    (le stream Anthropic peut se terminer pour cause d'inactivité; chaque
    //    nouvelle connexion client doit pouvoir relancer le pump pour récupérer
    //    les events que l'utilisateur a posté pendant l'absence). seenAnthropicIds
    //    persiste, donc pas de doublons.
    if (!state.pumpStarted) {
      void startPump(id);
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
  app.post("/api/image", writeLimit, budgetGuard, async (req, res) => {
    try {
      const prompt = (req.body?.prompt as string)?.trim();
      const altText = (req.body?.alt_text as string) || "";
      const title = (req.body?.title as string) || "";
      const aspectRatio = req.body?.aspect_ratio as any;
      const imageSize = req.body?.image_size as any;
      if (!prompt) return res.status(400).json({ error: "prompt required" });

      console.log(`[image] generate "${prompt.slice(0, 80)}..."`);
      const img = await generateImage({ prompt, aspectRatio, imageSize });
      getUsage().imageGenerated++;
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

  app.post("/api/wp/posts", writeLimit, async (req, res) => {
    try {
      const post = await createPost(req.body as WpPostInput);
      res.json(post);
    } catch (err: any) {
      console.error("[wp] create error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/wp/posts/:id", writeLimit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await updatePost(id, req.body as WpPostInput);
      res.json(post);
    } catch (err: any) {
      console.error("[wp] update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------- Draft (block editor) routes ---------------------
  // Dedicated SSE channel for the editor: draft.snapshot + draft.op events
  // forwarded from the in-memory projection mutated by the block_* tools.

  app.get("/api/sessions/:id/draft/stream", async (req, res) => {
    const { id } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    // Wait for disk hydration so the first snapshot reflects persisted state
    // (otherwise after a server restart the editor would briefly see empty
    // blocks before a real op refreshes it).
    const draft = await getDraftReady(id);
    res.write(`data: ${JSON.stringify(draft.snapshot())}\n\n`);
    draft.listeners.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, 15000);
    req.on("close", () => {
      draft.listeners.delete(res);
      clearInterval(heartbeat);
    });
  });

  app.get("/api/sessions/:id/draft", async (req, res) => {
    const draft = await getDraftReady(req.params.id);
    res.json({
      blocks: draft.state.blocks,
      meta: draft.state.meta,
      original: draft.state.original,
    });
  });

  /**
   * Flush user-driven editor edits (BlockNote onChange). Replaces blocks
   * wholesale and stamps user_edited_at on whatever changed. The agent
   * picks up the new state on its next turn via DOC_STATE injection.
   */
  app.put("/api/sessions/:id/draft/blocks", async (req, res) => {
    try {
      const draft = await getDraftReady(req.params.id);
      const blocks = req.body?.blocks;
      if (!Array.isArray(blocks))
        return res.status(400).json({ error: "blocks[] required" });
      draft.setBlocksFromUser(blocks);
      // No SSE emit: the user is the source of this change, no other client
      // needs to know (and the editor itself already shows them).
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Undo the last completed agent turn (rolls blocks back to pre-state). */
  app.post("/api/sessions/:id/draft/undo", async (req, res) => {
    try {
      const draft = await getDraftReady(req.params.id);
      const r = draft.undoLastTurn();
      if (!r.ok) return res.status(400).json({ error: r.reason });
      draft.emit(draft.snapshot());
      await draft.flush();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/sessions/:id/draft/meta", async (req, res) => {
    const draft = await getDraftReady(req.params.id);
    const patch = req.body as Partial<PostMeta>;
    draft.apply({ op: "meta_update", meta: patch });
    draft.emit({ type: "draft.op", op: { op: "meta_update", meta: patch } });
    res.json(draft.state.meta);
  });

  app.post("/api/sessions/:id/draft/load", writeLimit, async (req, res) => {
    try {
      const draft = await getDraftReady(req.params.id);
      const postId = Number(req.body?.id);
      if (!postId) return res.status(400).json({ error: "id required" });
      const post = (await getPost(postId)) as any;
      const html = post.content?.raw ?? post.content?.rendered ?? "";
      const blocks = htmlToBlocks(html);
      const meta: PostMeta = {
        post_id: post.id,
        title: post.title?.raw || post.title?.rendered || "",
        slug: post.slug || "",
        excerpt: post.excerpt?.raw || post.excerpt?.rendered || "",
        status: post.status || "draft",
        categories: post.categories || [],
        tags: post.tags || [],
        featured_media: post.featured_media || null,
        featured_media_url: null,
        modified_gmt: post.modified_gmt || null,
        seo: {
          title: post.meta?._yoast_wpseo_title || post.meta?.rank_math_title,
          description:
            post.meta?._yoast_wpseo_metadesc || post.meta?.rank_math_description,
          focus_keyword:
            post.meta?._yoast_wpseo_focuskw || post.meta?.rank_math_focus_keyword,
        },
      };
      draft.apply({ op: "doc_load", blocks, post_id: post.id, meta });
      draft.emit(draft.snapshot());
      await draft.flush();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Publish the current draft as a WP post (create or update based on
  // meta.post_id). Reuses createPost/updatePost which already handle dedup
  // and tag resolution.
  app.post("/api/sessions/:id/draft/publish", writeLimit, async (req, res) => {
    try {
      const draft = await getDraftReady(req.params.id);
      const meta = draft.state.meta;
      const html = blocksToHtml(draft.state.blocks);
      const status = (req.body?.status as string) || meta.status || "draft";
      const payload: WpPostInput = {
        title: meta.title,
        slug: meta.slug || undefined,
        content: html,
        excerpt: meta.excerpt || undefined,
        status: status as WpPostInput["status"],
        tags: meta.tags?.length ? (meta.tags as any) : undefined,
      };
      const result: any = meta.post_id
        ? await updatePost(meta.post_id, payload)
        : await createPost(payload);
      draft.state.meta = {
        ...draft.state.meta,
        post_id: result.id,
        status: status as any,
      };
      draft.state.original = JSON.parse(JSON.stringify(draft.state.blocks));
      draft.emit(draft.snapshot());
      await draft.flush();
      res.json(result);
    } catch (err: any) {
      console.error("[draft] publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sessions/:id/draft/media", writeLimit, async (req, res) => {
    try {
      const url = req.body?.url as string;
      if (!url) return res.status(400).json({ error: "url required" });
      const m = await uploadMediaFromUrl(url);
      res.json({ id: m.id, source_url: m.source_url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
