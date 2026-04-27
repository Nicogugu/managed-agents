import { randomUUID } from "node:crypto";
import type { BlockOp, DraftBlock, PostMeta } from "./contract.js";
import { getDraft } from "./draftStore.js";
import { htmlToBlocks } from "./htmlBlocks.js";
import {
  getPost,
  listPosts,
  listCategories,
  listTags,
  listMedia,
} from "./wordpress.js";

/**
 * Dispatcher for the block_* (and a few wp_* read helpers) custom tools used
 * by the editor streaming flow. Returns the textual content to put back into
 * the `user.custom_tool_result` event.
 *
 * Coexists with the legacy wp_image_generate / wp_publish tools wired in
 * app.ts — those keep their own dispatcher path. Returns null when the tool
 * isn't ours (so the caller falls through to the legacy dispatcher).
 */

function blockFromInput(input: any): DraftBlock {
  const type = input.type as DraftBlock["type"];
  const id: string = input.id || randomUUID();
  const props = input.props || {};
  if (type === "code" || type === "raw_html") {
    return { id, type, props: { ...props, raw: input.raw ?? input.text ?? "" } };
  }
  if (type === "image") return { id, type, props };
  if (type === "table") return { id, type, props: { ...props }, content: input.content };
  return { id, type, content: input.text ?? "", props };
}

function diag(text: string) {
  return [{ type: "text" as const, text }];
}

export const BLOCK_TOOL_NAMES = new Set([
  "doc_init",
  "block_insert",
  "block_update",
  "block_append_text",
  "block_delete",
  "block_move",
  "meta_update",
  "wp_load_post",
  "wp_search_posts",
  "wp_list_posts",
  "wp_get_post",
  "wp_list_categories",
  "wp_list_tags",
  "wp_list_media",
]);

export async function dispatchBlockTool(
  sessionId: string,
  name: string,
  input: any,
): Promise<{ content: { type: "text"; text: string }[]; is_error?: boolean } | null> {
  if (!BLOCK_TOOL_NAMES.has(name)) return null;
  const draft = getDraft(sessionId);
  const emit = (op: BlockOp, touchedId?: string) => {
    const r = draft.apply(op);
    if (!r.ok) return r;
    draft.emit({ type: "draft.op", op, touched_block_id: touchedId ?? r.touchedId });
    return r;
  };

  try {
    switch (name) {
      case "doc_init": {
        const blocks: DraftBlock[] = (input.blocks || []).map(blockFromInput);
        emit({ op: "doc_init", blocks });
        return {
          content: diag(
            `doc initialised with ${blocks.length} blocks. ids: ${blocks.map((b) => b.id).join(",")}`,
          ),
        };
      }
      case "block_insert": {
        const block = blockFromInput(input.block);
        emit({ op: "block_insert", after_id: input.after_id || null, block });
        return { content: diag(`inserted ${block.id}`) };
      }
      case "block_update": {
        const id = input.id;
        const patch: Partial<DraftBlock> = {};
        if (input.type) patch.type = input.type;
        if (input.text !== undefined) patch.content = input.text;
        if (input.raw !== undefined) {
          const cur = draft.state.blocks.find((b) => b.id === id);
          patch.props = { ...(cur?.props || {}), ...(input.props || {}), raw: input.raw };
        } else if (input.props) {
          patch.props = { ...(input.props || {}) };
        }
        const r = emit({ op: "block_update", id, patch });
        if (!r.ok) return { content: diag(r.error!), is_error: true };
        return { content: diag(`updated ${id}`) };
      }
      case "block_append_text": {
        const r = emit({
          op: "block_append_text",
          id: input.id,
          delta: input.delta || "",
        });
        if (!r.ok) return { content: diag(r.error!), is_error: true };
        return { content: diag("ok") };
      }
      case "block_delete": {
        const r = emit({ op: "block_delete", id: input.id });
        if (!r.ok) return { content: diag(r.error!), is_error: true };
        return { content: diag(`deleted ${input.id}`) };
      }
      case "block_move": {
        const r = emit({
          op: "block_move",
          id: input.id,
          after_id: input.after_id || null,
        });
        if (!r.ok) return { content: diag(r.error!), is_error: true };
        return { content: diag(`moved ${input.id}`) };
      }
      case "meta_update": {
        const meta: Partial<PostMeta> = {};
        if (input.title !== undefined) meta.title = input.title;
        if (input.slug !== undefined) meta.slug = input.slug;
        if (input.excerpt !== undefined) meta.excerpt = input.excerpt;
        if (input.status !== undefined) meta.status = input.status;
        if (input.scheduled_at !== undefined) meta.scheduled_at = input.scheduled_at;
        if (input.tags !== undefined) meta.tags = input.tags;
        if (input.featured_media_url !== undefined) {
          meta.featured_media_url = input.featured_media_url;
        }
        const seo: PostMeta["seo"] = {};
        if (input.seo_title !== undefined) seo.title = input.seo_title;
        if (input.seo_description !== undefined) seo.description = input.seo_description;
        if (input.seo_focus_keyword !== undefined) seo.focus_keyword = input.seo_focus_keyword;
        if (Object.keys(seo).length) meta.seo = seo;
        emit({ op: "meta_update", meta });
        return { content: diag("meta updated") };
      }

      // ---- WP read helpers ----
      case "wp_search_posts":
      case "wp_list_posts": {
        const hits = (await listPosts({
          search: input.query || input.search,
          status:
            input.status && input.status !== "any" ? input.status : undefined,
          per_page: input.per_page,
        })) as Array<{
          id: number;
          title: string;
          slug: string;
          status: string;
          date?: string;
          excerpt?: string;
          link?: string;
        }>;
        return { content: diag(JSON.stringify({ posts: hits }, null, 2)) };
      }
      case "wp_get_post": {
        const post = (await getPost(Number(input.id))) as any;
        // Return a compact view (drop _links, embedded, etc. that bloat tokens)
        const compact = {
          id: post.id,
          title: post.title?.raw || post.title?.rendered,
          slug: post.slug,
          status: post.status,
          date: post.date,
          excerpt: post.excerpt?.raw || post.excerpt?.rendered,
          content: post.content?.raw || post.content?.rendered,
          categories: post.categories,
          tags: post.tags,
          featured_media: post.featured_media,
          modified_gmt: post.modified_gmt,
          meta: {
            yoast_title: post.meta?._yoast_wpseo_title,
            yoast_description: post.meta?._yoast_wpseo_metadesc,
            yoast_focuskw: post.meta?._yoast_wpseo_focuskw,
            rank_math_title: post.meta?.rank_math_title,
            rank_math_description: post.meta?.rank_math_description,
          },
        };
        return { content: diag(JSON.stringify(compact, null, 2)) };
      }
      case "wp_list_categories": {
        const cats = await listCategories();
        return { content: diag(JSON.stringify({ categories: cats }, null, 2)) };
      }
      case "wp_list_tags": {
        const tags = await listTags(input.search);
        return { content: diag(JSON.stringify({ tags }, null, 2)) };
      }
      case "wp_list_media": {
        const media = await listMedia(input.per_page ?? 20);
        return { content: diag(JSON.stringify({ media }, null, 2)) };
      }
      case "wp_load_post": {
        const post = (await getPost(Number(input.id))) as any;
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
        emit({ op: "doc_load", blocks, post_id: post.id, meta });
        const idsTable = blocks
          .slice(0, 50)
          .map((b) => `${b.id}\t${b.type}`)
          .join("\n");
        return {
          content: diag(
            `Loaded post #${post.id} "${meta.title}" (${meta.status}). ${blocks.length} blocks. Use block_update on these ids:\n${idsTable}`,
          ),
        };
      }
    }
  } catch (err: any) {
    return { content: diag(err.message || String(err)), is_error: true };
  }
  return null;
}
