import { createHash } from "node:crypto";
import type { Response } from "express";
import { client } from "./anthropic.js";
import { listPosts } from "./wordpress.js";
import {
  getOrCreateReviewerAgent,
  getReviewerEnvironment,
  REVIEW_SUBMIT_TOOL_NAME,
  REVIEWER_LABELS,
  type ReviewFinding,
  type ReviewKind,
} from "./reviewers.js";
import type { DraftBlock, PostMeta } from "./contract.js";
import { getDraftReady } from "./draftStore.js";

/**
 * Pre-publish review pipeline runner.
 *
 * Flow per kind requested:
 *   1. spawn a fresh Anthropic session against the dedicated reviewer agent
 *   2. POST a single user.message: [ARTICLE_DRAFT] context + role brief
 *   3. tail events; intercept agent.custom_tool_use for `submit_review_findings`
 *      and (for the links reviewer) `wp_list_posts` — execute them server-side
 *   4. once findings are submitted, send acknowledgment + close the session
 *   5. push status updates back through the per-(parent-session) SSE bus
 */

export type ReviewStatus =
  | { state: "queued" }
  | { state: "running"; started_at: number }
  | {
      state: "passed" | "warned" | "failed";
      findings: ReviewFinding[];
      finished_at: number;
      duration_ms: number;
    }
  | { state: "error"; error: string; finished_at: number };

export interface ReviewSnapshot {
  /** Hash of the article + meta this review batch ran against. */
  content_hash: string;
  results: Partial<Record<ReviewKind, ReviewStatus>>;
}

/** Content hash so we can dedupe a re-trigger when nothing changed. */
function hashContent(blocks: DraftBlock[], meta: PostMeta): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(blocks));
  h.update("|");
  h.update(JSON.stringify({ ...meta, modified_gmt: undefined }));
  return h.digest("hex").slice(0, 16);
}

interface BusEvent {
  type:
    | "review.batch_started"
    | "review.kind_started"
    | "review.kind_finished"
    | "review.batch_finished";
  kind?: ReviewKind;
  status?: ReviewStatus;
  content_hash?: string;
  results?: ReviewSnapshot["results"];
}

interface BusState {
  snapshot: ReviewSnapshot;
  listeners: Set<Response>;
  /** AbortController for an in-flight batch — lets us cancel the previous
   *  batch when the user re-triggers a different kind set. */
  inFlight?: AbortController;
}

const buses = new Map<string, BusState>();

function getBus(parentSessionId: string): BusState {
  let b = buses.get(parentSessionId);
  if (!b) {
    b = {
      snapshot: { content_hash: "", results: {} },
      listeners: new Set(),
    };
    buses.set(parentSessionId, b);
  }
  return b;
}

function emit(parentSessionId: string, ev: BusEvent) {
  const bus = getBus(parentSessionId);
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of bus.listeners) {
    try {
      res.write(payload);
    } catch {
      bus.listeners.delete(res);
    }
  }
}

export function attachReviewListener(
  parentSessionId: string,
  res: Response,
): () => void {
  const bus = getBus(parentSessionId);
  // Initial snapshot so a reconnecting client gets the latest state.
  res.write(
    `data: ${JSON.stringify({
      type: "review.batch_finished",
      content_hash: bus.snapshot.content_hash,
      results: bus.snapshot.results,
    })}\n\n`,
  );
  bus.listeners.add(res);
  return () => {
    bus.listeners.delete(res);
  };
}

function buildBriefForReviewer(
  blocks: DraftBlock[],
  meta: PostMeta,
  kind: ReviewKind,
): string {
  // Compact block view — drop noisy fields.
  const compact = blocks.map((b) => {
    const out: any = { id: b.id, type: b.type };
    const txt =
      typeof b.content === "string"
        ? b.content
        : Array.isArray(b.content)
          ? (b.content as any[])
              .map((c) => (typeof c === "string" ? c : c?.text || ""))
              .join("")
          : "";
    if (txt) out.text = txt;
    if (b.type === "code" || b.type === "raw_html") {
      out.raw =
        (b.props as any)?.raw ?? (b.props as any)?.html ?? "";
    }
    if (b.type === "heading" && (b.props as any)?.level)
      out.level = (b.props as any).level;
    if (b.type === "image")
      out.image_url = (b.props as any)?.url ?? "";
    return out;
  });

  const articleJson = JSON.stringify(
    {
      meta: {
        title: meta.title,
        slug: meta.slug,
        excerpt: meta.excerpt,
        post_id: meta.post_id ?? null,
        tags: meta.tags ?? [],
        categories: meta.categories ?? [],
      },
      blocks: compact,
    },
    null,
    2,
  );

  return [
    "[ARTICLE_DRAFT]",
    articleJson,
    "[/ARTICLE_DRAFT]",
    "",
    `Tu es le reviewer **${REVIEWER_LABELS[kind]}**. Analyse l'article ci-dessus et rends ton rapport via \`submit_review_findings\`.`,
  ].join("\n");
}

async function runOneReview(
  parentSessionId: string,
  kind: ReviewKind,
  blocks: DraftBlock[],
  meta: PostMeta,
  signal: AbortSignal,
): Promise<ReviewStatus> {
  const startedAt = Date.now();
  const bus = getBus(parentSessionId);
  bus.snapshot.results[kind] = { state: "running", started_at: startedAt };
  emit(parentSessionId, {
    type: "review.kind_started",
    kind,
    status: bus.snapshot.results[kind],
  });

  let reviewerSessionId: string | undefined;
  try {
    const [agentId, envId] = await Promise.all([
      getOrCreateReviewerAgent(kind),
      getReviewerEnvironment(),
    ]);
    if (signal.aborted) throw new Error("aborted");

    const session = await client.beta.sessions.create({
      agent: agentId,
      environment_id: envId,
      title: `review:${kind} for ${parentSessionId}`,
    });
    reviewerSessionId = session.id;
    if (signal.aborted) throw new Error("aborted");

    await client.beta.sessions.events.send(reviewerSessionId, {
      events: [
        {
          type: "user.message",
          content: [
            { type: "text", text: buildBriefForReviewer(blocks, meta, kind) },
          ],
        },
      ],
    });

    let findings: ReviewFinding[] | null = null;
    const stream = await client.beta.sessions.events.stream(reviewerSessionId);
    for await (const ev of stream as any) {
      if (signal.aborted) break;
      if (ev?.type === "agent.custom_tool_use") {
        const useId = ev.id as string;
        const name = ev.name as string;
        const input = (ev.input || {}) as any;

        if (name === REVIEW_SUBMIT_TOOL_NAME) {
          findings = Array.isArray(input.findings)
            ? (input.findings as ReviewFinding[])
            : [];
          // Acknowledge so the agent stops cleanly.
          try {
            await client.beta.sessions.events.send(reviewerSessionId, {
              events: [
                {
                  type: "user.custom_tool_result",
                  custom_tool_use_id: useId,
                  is_error: false,
                  content: [
                    { type: "text", text: `received ${findings.length} findings; you can stop now.` },
                  ],
                } as any,
              ],
            });
          } catch {}
          break; // we have what we need
        }

        if (name === "wp_list_posts" && kind === "links") {
          let result = "";
          let isError = false;
          try {
            const hits = await listPosts({
              search: input.search,
              status: input.status === "any" ? undefined : input.status,
              per_page: Math.min(50, input.per_page ?? 20),
            });
            result = JSON.stringify(
              hits.map((h: any) => ({
                id: h.id,
                title: h.title,
                slug: h.slug,
                status: h.status,
              })),
            );
          } catch (err: any) {
            result = err?.message || "wp_list_posts failed";
            isError = true;
          }
          try {
            await client.beta.sessions.events.send(reviewerSessionId, {
              events: [
                {
                  type: "user.custom_tool_result",
                  custom_tool_use_id: useId,
                  is_error: isError,
                  content: [{ type: "text", text: result }],
                } as any,
              ],
            });
          } catch {}
        }
      }
    }

    if (findings === null) throw new Error("reviewer didn't submit findings");

    const finishedAt = Date.now();
    const hasError = findings.some((f) => f.severity === "error");
    const hasWarn = findings.some((f) => f.severity === "warn");
    const state: ReviewStatus["state"] = hasError
      ? "failed"
      : hasWarn || findings.length > 0
        ? "warned"
        : "passed";
    return {
      state,
      findings,
      finished_at: finishedAt,
      duration_ms: finishedAt - startedAt,
    } as ReviewStatus;
  } catch (err: any) {
    return {
      state: "error",
      error: err?.message || "review failed",
      finished_at: Date.now(),
    };
  } finally {
    if (reviewerSessionId) {
      // Best-effort cleanup. Sessions auto-archive but explicit delete keeps
      // the dashboard clean.
      try {
        await (client.beta as any).sessions.delete(reviewerSessionId);
      } catch {}
    }
  }
}

export async function startReviewBatch(
  parentSessionId: string,
  kinds: ReviewKind[],
): Promise<{ content_hash: string; cached: boolean }> {
  const draft = await getDraftReady(parentSessionId);
  const blocks = draft.state.blocks;
  const meta = draft.state.meta;
  const hash = hashContent(blocks, meta);
  const bus = getBus(parentSessionId);

  // Cache: if same content hash AND all requested kinds already have a
  // terminal result, return immediately.
  if (
    bus.snapshot.content_hash === hash &&
    kinds.every((k) => {
      const r = bus.snapshot.results[k];
      return r && r.state !== "queued" && r.state !== "running";
    })
  ) {
    emit(parentSessionId, {
      type: "review.batch_finished",
      content_hash: hash,
      results: bus.snapshot.results,
    });
    return { content_hash: hash, cached: true };
  }

  // Cancel any in-flight batch — the new one wins.
  bus.inFlight?.abort();
  const ac = new AbortController();
  bus.inFlight = ac;
  // Reset hash + results for the requested kinds (keep results for kinds
  // not in this batch as long as they're for the same content hash).
  if (bus.snapshot.content_hash !== hash) {
    bus.snapshot = { content_hash: hash, results: {} };
  }
  for (const k of kinds) bus.snapshot.results[k] = { state: "queued" };

  emit(parentSessionId, {
    type: "review.batch_started",
    content_hash: hash,
    results: bus.snapshot.results,
  });

  // Fire all reviewers in parallel.
  void Promise.allSettled(
    kinds.map(async (k) => {
      const status = await runOneReview(
        parentSessionId,
        k,
        blocks,
        meta,
        ac.signal,
      );
      bus.snapshot.results[k] = status;
      emit(parentSessionId, {
        type: "review.kind_finished",
        kind: k,
        status,
      });
    }),
  ).then(() => {
    if (ac.signal.aborted) return;
    emit(parentSessionId, {
      type: "review.batch_finished",
      content_hash: hash,
      results: bus.snapshot.results,
    });
    if (bus.inFlight === ac) bus.inFlight = undefined;
  });

  return { content_hash: hash, cached: false };
}

export function getReviewSnapshot(parentSessionId: string): ReviewSnapshot {
  return getBus(parentSessionId).snapshot;
}
