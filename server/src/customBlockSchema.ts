/**
 * Generic descriptor for a custom Gutenberg block coming from a WP plugin
 * (Superprof, future clients). The same shape is duplicated client-side
 * with extra render functions; server-side only needs the schema for
 * parse/serialize.
 *
 * This is the core abstraction: one descriptor per WP block type =>
 * fully wired in editor + parser + serializer + agent tools, no
 * additional plumbing needed when onboarding a new client.
 */

export type AttrType =
  | "text"        // single-line input
  | "textarea"    // multi-line input
  | "number"      // integer input
  | "boolean"     // checkbox
  | "uuid"        // generated, not user-editable
  | "color";      // color picker (hex string)

export interface BlockAttrSpec {
  /** Key in the attribute JSON of the Gutenberg comment. */
  name: string;
  /** Label shown in the inline edit form (omit for hidden / autogen attrs). */
  label?: string;
  type: AttrType;
  required?: boolean;
  /**
   * If set, the value is auto-generated when the block is created (e.g.
   * pollId, choiceId). For "uuid" → crypto.randomUUID(). For "index" → the
   * 0-based index within the parent's children array.
   */
  autogen?: "uuid" | "index";
  /** Optional default for non-required fields. */
  default?: string | number | boolean;
  /** Hint shown under the input. */
  description?: string;
}

/**
 * Spec for a block type that contains a list of repeatable child blocks
 * (e.g. polls-block contains N poll-item, timeline-block contains N
 * timeline-container). Children are rendered as a sub-list with
 * add/remove/reorder controls in the editor.
 */
export interface ChildrenSpec {
  /** WP namespace of the inner block (e.g. "poll/poll-item"). */
  itemNamespace: string;
  /** Attributes of each child item. */
  attrs: BlockAttrSpec[];
  /** Min/max items (optional UX guard). */
  min?: number;
  max?: number;
  /** Label for the "+ Add" button. */
  addLabel?: string;
  /**
   * For self-closing inner blocks (`<!-- wp:foo {...} /-->`), set this to
   * true. Otherwise the parser/serializer expects opening + closing
   * comments with inner DOM.
   */
  selfClosing?: boolean;
}

/**
 * Parser/serializer side of a custom block. Render is web-only and lives
 * in a parallel UI descriptor. Keep this one shareable between server
 * and web.
 */
export interface ClientBlockSchema {
  /** WP namespace, e.g. "superprof/quote-block". Doubles as unique id. */
  namespace: string;
  /** Top-level attributes encoded in the `<!-- wp:namespace {…} -->` comment. */
  attrs: BlockAttrSpec[];
  /** Optional repeatable children spec. */
  children?: ChildrenSpec;
  /**
   * Static class name applied on the outer DOM wrapper at serialization.
   * If omitted, derived from namespace ("superprof/quote-block" →
   * "wp-block-superprof-quote-block").
   */
  wrapperClass?: string;
}

export type ClientBlockAttrs = Record<string, string | number | boolean>;
export type ClientBlockChild = { attrs: ClientBlockAttrs };

/** Concrete instance stored in DraftBlock.props for the generic clientBlock. */
export interface ClientBlockInstance {
  namespace: string;
  attrs: ClientBlockAttrs;
  children?: ClientBlockChild[];
}
