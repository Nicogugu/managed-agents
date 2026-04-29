/**
 * Shared contract between Managed Agent, server and web editor.
 *
 * The agent talks via Anthropic "custom tools" (BetaManagedAgentsCustomToolParams).
 * The server executes them, mutates the in-memory draft projection, and emits
 * `block:*` SSE events forwarded to the editor.
 *
 * Types here MUST stay in sync with web/src/contract.ts.
 */

// ---------------------------------------------------------------------------
// Block model — minimal superset of BlockNote-compatible blocks
// ---------------------------------------------------------------------------

export type BlockType =
  | "paragraph"
  | "heading" // props.level: 1|2|3
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "code" // props.language
  | "image" // props.url, props.alt, props.caption
  | "table"
  | "raw_html" // fallback for shortcodes / Gutenberg blocks we cannot parse
  | "client_block"; // typed Gutenberg custom block (Superprof + future clients)

export type BlockProps = Record<string, unknown>;

export interface DraftBlock {
  id: string; // stable uuid
  type: BlockType;
  /** BlockNote-style inline content (text + marks) OR plain string for code/raw_html */
  content?: unknown;
  props?: BlockProps;
  children?: DraftBlock[];
}

// ---------------------------------------------------------------------------
// Block ops — agent-driven mutations of the draft
// ---------------------------------------------------------------------------

export type BlockOp =
  | { op: "doc_init"; blocks: DraftBlock[]; post_id?: number }
  | { op: "doc_load"; blocks: DraftBlock[]; post_id: number; meta: PostMeta }
  | { op: "block_insert"; after_id: string | null; block: DraftBlock }
  | { op: "block_update"; id: string; patch: Partial<DraftBlock> }
  | { op: "block_append_text"; id: string; delta: string }
  | { op: "block_delete"; id: string }
  | { op: "block_move"; id: string; after_id: string | null }
  | { op: "meta_update"; meta: Partial<PostMeta> };

// ---------------------------------------------------------------------------
// WP meta
// ---------------------------------------------------------------------------

export type PostStatus = "draft" | "publish" | "pending" | "private" | "future";

export interface PostMeta {
  post_id?: number;
  title: string;
  slug: string;
  excerpt: string;
  status: PostStatus;
  /** ISO datetime when status === "future" */
  scheduled_at?: string | null;
  categories: number[];
  tags: (string | number)[];
  featured_media?: number | null;
  featured_media_url?: string | null;
  seo: {
    title?: string;
    description?: string;
    focus_keyword?: string;
  };
  /** From WP ?context=edit, used to detect remote conflicts */
  modified_gmt?: string | null;
}

export const emptyMeta: PostMeta = {
  title: "",
  slug: "",
  excerpt: "",
  status: "draft",
  categories: [],
  tags: [],
  featured_media: null,
  featured_media_url: null,
  seo: {},
};

// ---------------------------------------------------------------------------
// SSE events emitted to the web client
// ---------------------------------------------------------------------------

export type DraftEvent =
  | {
      type: "draft.snapshot";
      blocks: DraftBlock[];
      meta: PostMeta;
      original?: DraftBlock[] | null;
      /** Per-block metadata (locked + edit timestamps). Optional for back-compat. */
      blockMeta?: Record<string, { locked?: boolean; user_edited_at?: number; agent_edited_at?: number }>;
    }
  | { type: "draft.op"; op: BlockOp; touched_block_id?: string }
  | { type: "draft.error"; message: string };

// ---------------------------------------------------------------------------
// Custom tool definitions sent to the Managed Agent.
// ---------------------------------------------------------------------------

import type { BetaManagedAgentsCustomToolParams } from "@anthropic-ai/sdk/resources/beta/agents/agents.js";

const blockSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: [
        "paragraph",
        "heading",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "quote",
        "code",
        "image",
        "table",
        "raw_html",
      ],
    },
    /** Inline text content. For most blocks this is plain text (we'll convert to inline). */
    text: { type: "string" },
    /** For code/raw_html: literal payload */
    raw: { type: "string" },
    props: {
      type: "object",
      properties: {
        level: { type: "number", description: "heading level 1-3" },
        language: { type: "string", description: "code language" },
        url: { type: "string", description: "image url" },
        alt: { type: "string" },
        caption: { type: "string" },
        checked: { type: "boolean" },
      },
    },
  },
  required: ["type"],
} as const;

const blockListSchema = { type: "array", items: blockSchema } as const;

export const AGENT_TOOLS: BetaManagedAgentsCustomToolParams[] = [
  // ---- Block ops ----
  {
    type: "custom",
    name: "doc_init",
    description:
      "Initialise the article being drafted with a list of blocks. Use when starting a brand-new article. Always call this BEFORE any block_insert/update on a fresh draft.",
    input_schema: {
      type: "object",
      properties: { blocks: blockListSchema },
      required: ["blocks"],
    },
  },
  {
    type: "custom",
    name: "block_insert",
    description:
      "Insert a single block after `after_id` (or at the top if null). Returns the new block id.",
    input_schema: {
      type: "object",
      properties: {
        after_id: { type: "string", description: "Existing block id, or null/empty for top." },
        block: blockSchema,
      },
      required: ["block"],
    },
  },
  {
    type: "custom",
    name: "block_update",
    description:
      "Replace the content/props of an existing block. The patch is shallow-merged onto the block. Use this for full-block rewrites; use block_append_text for streaming token-by-token.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: blockSchema.properties.type,
        text: { type: "string" },
        raw: { type: "string" },
        props: blockSchema.properties.props,
      },
      required: ["id"],
    },
  },
  {
    type: "custom",
    name: "block_append_text",
    description:
      "Append a text delta to an existing text block. Use for streaming long blocks token by token. Cheap and re-renders only the targeted block.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, delta: { type: "string" } },
      required: ["id", "delta"],
    },
  },
  {
    type: "custom",
    name: "block_delete",
    description: "Delete a block by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    type: "custom",
    name: "block_move",
    description: "Move a block to be placed after `after_id` (or null for top).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, after_id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    type: "custom",
    name: "meta_update",
    description:
      "Patch the post metadata: title, slug, excerpt, status, scheduled_at, categories, tags, featured_media_url (will be uploaded), or SEO fields.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: { type: "string" },
        excerpt: { type: "string" },
        status: {
          type: "string",
          enum: ["draft", "publish", "pending", "private", "future"],
        },
        scheduled_at: { type: "string", description: "ISO datetime, only for status=future" },
        category_names: {
          type: "array",
          items: { type: "string" },
          description: "Will be resolved/created to ids server-side.",
        },
        tags: { type: "array", items: { type: "string" } },
        featured_media_url: {
          type: "string",
          description: "URL to fetch and upload as featured image.",
        },
        seo_title: { type: "string" },
        seo_description: { type: "string" },
        seo_focus_keyword: { type: "string" },
      },
    },
  },

  // ---- WordPress ops ----
  {
    type: "custom",
    name: "wp_search_posts",
    description:
      "Search WordPress posts by title or slug. Returns up to 10 hits with id, title, slug, status.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: {
          type: "string",
          enum: ["any", "draft", "publish", "pending", "private", "future"],
        },
      },
      required: ["query"],
    },
  },
  {
    type: "custom",
    name: "wp_load_post",
    description:
      "Load a WordPress post into the editor. Replaces current draft. The editor receives a `doc_load` event and the agent gets back the list of block ids it can target.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    type: "custom",
    name: "wp_publish",
    description:
      "Publish (or save) the current draft to WordPress. If post_id is set, performs an UPDATE. Returns the WP post object.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "publish", "pending", "private", "future"],
        },
      },
    },
  },
];
