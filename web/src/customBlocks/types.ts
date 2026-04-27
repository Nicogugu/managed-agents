/**
 * Mirror of server/src/customBlockSchema.ts (no shared workspace).
 * Kept in sync manually.
 */

export type AttrType = "text" | "textarea" | "number" | "boolean" | "uuid" | "color";

export interface BlockAttrSpec {
  name: string;
  label?: string;
  type: AttrType;
  required?: boolean;
  autogen?: "uuid" | "index";
  default?: string | number | boolean;
  description?: string;
}

export interface ChildrenSpec {
  itemNamespace: string;
  attrs: BlockAttrSpec[];
  min?: number;
  max?: number;
  addLabel?: string;
  selfClosing?: boolean;
}

export interface ClientBlockSchema {
  namespace: string;
  attrs: BlockAttrSpec[];
  children?: ChildrenSpec;
  wrapperClass?: string;
}

export type ClientBlockAttrs = Record<string, string | number | boolean>;
export type ClientBlockChild = { attrs: ClientBlockAttrs };

export interface ClientBlockInstance {
  namespace: string;
  attrs: ClientBlockAttrs;
  children?: ClientBlockChild[];
}

/** Web-only descriptor: schema + UI metadata (label, icon, optional render). */
export interface ClientBlockDescriptor extends ClientBlockSchema {
  /** Human label, used in slash menu. */
  label: string;
  /** Emoji or short string, displayed as block icon. */
  icon: string;
  /** Group/family name for slash menu (optional). Defaults to "Custom". */
  group?: string;
  /**
   * Optional custom render. If omitted, a generic preview is auto-built
   * from the attrs (label: value pairs).
   */
  render?: (props: {
    attrs: ClientBlockAttrs;
    children?: ClientBlockChild[];
  }) => React.ReactNode;
}
