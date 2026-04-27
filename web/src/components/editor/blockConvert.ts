import type { DraftBlock } from "../../contract";

/**
 * DraftBlock <-> BlockNote PartialBlock conversion.
 *
 * BlockNote uses different block names for some types (codeBlock vs code).
 * Inline content: BlockNote expects an array of inline content objects, but
 * accepts a plain string as a shortcut. We use the string shortcut on input
 * for simplicity (matches what the agent sends).
 */

export function draftToBN(b: DraftBlock): any {
  const id = b.id;
  const props = b.props || {};
  switch (b.type) {
    case "paragraph":
      return { id, type: "paragraph", content: stringContent(b.content) };
    case "heading":
      return {
        id,
        type: "heading",
        props: { level: clampLevel(props.level) },
        content: stringContent(b.content),
      };
    case "bulletListItem":
      return { id, type: "bulletListItem", content: stringContent(b.content) };
    case "numberedListItem":
      return { id, type: "numberedListItem", content: stringContent(b.content) };
    case "checkListItem":
      return {
        id,
        type: "checkListItem",
        props: { checked: Boolean(props.checked) },
        content: stringContent(b.content),
      };
    case "quote":
      return { id, type: "quote", content: stringContent(b.content) };
    case "code":
      return {
        id,
        type: "codeBlock",
        props: { language: String(props.language || "") },
        content: String(props.raw ?? b.content ?? ""),
      };
    case "image":
      return {
        id,
        type: "image",
        props: {
          url: String(props.url || ""),
          caption: String(props.caption || ""),
          name: String(props.alt || ""),
        },
      };
    case "table":
      return { id, type: "table", content: b.content as any };
    case "raw_html":
      return { id, type: "rawHtml", props: { html: String(props.html || "") } };
  }
}

export function bnToDraft(b: any): DraftBlock {
  const id: string = b.id;
  switch (b.type) {
    case "paragraph":
      return { id, type: "paragraph", content: extractText(b.content) };
    case "heading":
      return {
        id,
        type: "heading",
        content: extractText(b.content),
        props: { level: clampLevel(b.props?.level) },
      };
    case "bulletListItem":
      return { id, type: "bulletListItem", content: extractText(b.content) };
    case "numberedListItem":
      return { id, type: "numberedListItem", content: extractText(b.content) };
    case "checkListItem":
      return {
        id,
        type: "checkListItem",
        content: extractText(b.content),
        props: { checked: Boolean(b.props?.checked) },
      };
    case "quote":
      return { id, type: "quote", content: extractText(b.content) };
    case "codeBlock":
      return {
        id,
        type: "code",
        props: {
          language: String(b.props?.language || ""),
          raw: typeof b.content === "string" ? b.content : extractText(b.content),
        },
      };
    case "image":
      return {
        id,
        type: "image",
        props: {
          url: String(b.props?.url || ""),
          alt: String(b.props?.name || ""),
          caption: String(b.props?.caption || ""),
        },
      };
    case "table":
      return { id, type: "table", content: b.content };
    case "rawHtml":
      return { id, type: "raw_html", props: { html: String(b.props?.html || "") } };
    default:
      // Unknown block type: serialize as raw_html with HTML rendering of inline content
      return { id, type: "paragraph", content: extractText(b.content) };
  }
}

function clampLevel(v: unknown): number {
  const n = Number(v) || 1;
  return Math.min(3, Math.max(1, Math.round(n)));
}

function stringContent(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  return extractText(c);
}

function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as any[])
    .map((c) => {
      if (typeof c === "string") return c;
      if (c?.type === "text") return c.text || "";
      if (c?.type === "link") return extractText(c.content || []);
      return "";
    })
    .join("");
}
