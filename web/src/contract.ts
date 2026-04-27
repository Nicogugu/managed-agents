/**
 * Mirror of server/src/contract.ts (kept in sync manually since web and server
 * are separate npm packages without a shared workspace).
 */

export type BlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "code"
  | "image"
  | "table"
  | "raw_html";

export type BlockProps = Record<string, unknown>;

export interface DraftBlock {
  id: string;
  type: BlockType;
  content?: unknown;
  props?: BlockProps;
  children?: DraftBlock[];
}

export type BlockOp =
  | { op: "doc_init"; blocks: DraftBlock[]; post_id?: number }
  | { op: "doc_load"; blocks: DraftBlock[]; post_id: number; meta: PostMeta }
  | { op: "block_insert"; after_id: string | null; block: DraftBlock }
  | { op: "block_update"; id: string; patch: Partial<DraftBlock> }
  | { op: "block_append_text"; id: string; delta: string }
  | { op: "block_delete"; id: string }
  | { op: "block_move"; id: string; after_id: string | null }
  | { op: "meta_update"; meta: Partial<PostMeta> };

export type PostStatus = "draft" | "publish" | "pending" | "private" | "future";

export interface PostMeta {
  post_id?: number;
  title: string;
  slug: string;
  excerpt: string;
  status: PostStatus;
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

export type DraftEvent =
  | {
      type: "draft.snapshot";
      blocks: DraftBlock[];
      meta: PostMeta;
      original?: DraftBlock[] | null;
      blockMeta?: Record<
        string,
        { locked?: boolean; user_edited_at?: number; agent_edited_at?: number }
      >;
    }
  | { type: "draft.op"; op: BlockOp; touched_block_id?: string }
  | { type: "draft.error"; message: string };
