import type { DraftBlock, PostMeta } from "./contract.js";

/**
 * Builds a compact text representation of the current draft for injection
 * into the user.message sent to the agent. The agent reads this on every
 * turn so it always knows the live state — no more drifting on stale
 * mental models from its own past output.
 *
 * Token budget: aim for < 2k tokens on a 800-word article. Truncate block
 * content if total exceeds budget (paragraphs first, headings last).
 */

interface BuildOptions {
  selectionBlockIds?: string[];
  /** ms since now under which a block is considered "user just touched it" */
  userEditedWindowMs?: number;
  maxChars?: number;
}

interface CompactBlock {
  id: string;
  type: string;
  text?: string;
  raw?: string;
  level?: number;
  language?: string;
  user_edited?: boolean;
  agent_edited?: boolean;
}

function compactBlock(
  b: DraftBlock,
  meta: { user_edited_at?: number; agent_edited_at?: number } | undefined,
  userWindowMs: number,
  agentWindowMs: number,
): CompactBlock {
  const now = Date.now();
  const out: CompactBlock = { id: b.id, type: b.type };
  const txt = typeof b.content === "string" ? b.content : extractText(b.content);
  if (b.type === "code" || b.type === "raw_html") {
    out.raw = String((b.props as any)?.raw ?? (b.props as any)?.html ?? txt);
  } else if (txt) {
    out.text = txt;
  }
  if (b.type === "heading") {
    out.level = Number((b.props as any)?.level ?? 2);
  }
  if (b.type === "code" && (b.props as any)?.language) {
    out.language = String((b.props as any).language);
  }
  if (meta?.user_edited_at && now - meta.user_edited_at < userWindowMs) {
    out.user_edited = true;
  }
  if (meta?.agent_edited_at && now - meta.agent_edited_at < agentWindowMs) {
    out.agent_edited = true;
  }
  return out;
}

function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as any[])
    .map((c) =>
      typeof c === "string" ? c : c?.type === "text" ? c.text || "" : "",
    )
    .join("");
}

export function buildDocState(
  blocks: DraftBlock[],
  meta: PostMeta,
  blockMeta: Record<string, { user_edited_at?: number; agent_edited_at?: number }>,
  opts: BuildOptions = {},
): string {
  const max = opts.maxChars ?? 12000; // ~3k tokens
  const userWindow = opts.userEditedWindowMs ?? 5 * 60 * 1000; // 5 min
  const agentWindow = 2 * 60 * 1000;

  const compactBlocks = blocks.map((b) =>
    compactBlock(b, blockMeta[b.id], userWindow, agentWindow),
  );

  // Truncate text fields if needed (keep type + id + flags always)
  const payload = {
    meta: {
      title: meta.title || "",
      slug: meta.slug || "",
      excerpt: meta.excerpt || "",
      status: meta.status || "draft",
      tags: meta.tags || [],
      categories: meta.categories || [],
      featured_media: meta.featured_media || null,
      post_id: meta.post_id || null,
      seo: meta.seo || {},
    },
    blocks: compactBlocks,
    selection: {
      block_ids: opts.selectionBlockIds || [],
    },
  };

  let json = JSON.stringify(payload, null, 2);
  if (json.length > max) {
    // Aggressive truncation: chop block.text/.raw to first 200 chars and add a marker.
    for (const b of compactBlocks) {
      if (b.text && b.text.length > 200) b.text = b.text.slice(0, 200) + "…";
      if (b.raw && b.raw.length > 200) b.raw = b.raw.slice(0, 200) + "…";
    }
    json = JSON.stringify(payload, null, 2);
  }

  return [
    "[DOC_STATE]",
    "L'état actuel de l'article dans l'éditeur Notion (source de vérité). Utilise les `id` pour cibler `block_update`/`block_delete`/`block_move`. `user_edited: true` = le user vient d'éditer ce bloc — sois prudent. `selection.block_ids` = ce que le user vise par « ce bloc ».",
    json,
    "[/DOC_STATE]",
  ].join("\n");
}
