/**
 * Server-side HTML <-> DraftBlock conversion.
 *
 * Goal: round-trip should be lossless. Anything we don't understand is captured
 * in a `raw_html` block. The agent can still target it by id (e.g. delete it),
 * just not edit its inline text.
 *
 * Implementation: lightweight tag-aware splitter. Avoids pulling jsdom/cheerio
 * to keep the server light. For richer parsing the editor uses BlockNote's
 * `tryParseHTMLToBlocks` client-side; this server fallback is used to seed the
 * draft from WP's stored HTML.
 */

import type { DraftBlock, BlockType } from "./contract.js";
import { randomUUID } from "node:crypto";
import {
  parseGutenbergBlock,
  serializeGutenbergBlock,
} from "./gutenberg.js";
import type { ClientBlockInstance } from "./customBlockSchema.js";

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "img",
  "table",
  "figure",
  "div",
]);

interface Token {
  raw: string;
  tag: string | null; // lowercase tag of the outer element, or null for text
}

/**
 * Greedy top-level splitter. Walks the string character by character, tracks
 * tag depth, and emits one token per top-level block element (or text run).
 * Gutenberg comments like `<!-- wp:paragraph -->` are kept attached to their
 * following block by being treated as text tokens which we re-attach.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    if (html[i] !== "<") {
      // text run
      const start = i;
      while (i < len && html[i] !== "<") i++;
      const txt = html.slice(start, i);
      if (txt.trim()) tokens.push({ raw: txt, tag: null });
      continue;
    }
    // comment
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? len : end + 3;
      tokens.push({ raw: html.slice(i, stop), tag: null });
      i = stop;
      continue;
    }
    // self-closing or void tag
    const tagMatch = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i));
    if (!tagMatch) {
      // stray "<" — treat as text
      tokens.push({ raw: "<", tag: null });
      i++;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    if (tag === "img" || tag === "br" || tag === "hr") {
      // void tag: find ">"
      const close = html.indexOf(">", i);
      const stop = close === -1 ? len : close + 1;
      tokens.push({ raw: html.slice(i, stop), tag });
      i = stop;
      continue;
    }
    // find matching close tag, respecting depth
    const openRe = new RegExp(`<\\s*${tag}(\\s|>|/)`, "gi");
    const closeRe = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "gi");
    openRe.lastIndex = i + 1;
    closeRe.lastIndex = i + 1;
    let depth = 1;
    let pos = i + 1;
    while (depth > 0 && pos < len) {
      openRe.lastIndex = pos;
      closeRe.lastIndex = pos;
      const o = openRe.exec(html);
      const c = closeRe.exec(html);
      if (!c) break;
      if (o && o.index < c.index) {
        depth++;
        pos = o.index + 1;
      } else {
        depth--;
        pos = c.index + c[0].length;
      }
    }
    tokens.push({ raw: html.slice(i, pos), tag });
    i = pos;
  }
  return tokens;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function attr(html: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = re.exec(html);
  return m ? m[1] : undefined;
}

function listItems(listHtml: string): string[] {
  const items: string[] = [];
  const re = /<li[\s\S]*?>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listHtml)) !== null) items.push(m[1]);
  return items;
}

function uid(): string {
  return randomUUID();
}

export function htmlToBlocks(html: string): DraftBlock[] {
  if (!html || !html.trim()) return [];

  // First pass: peel off any registered Gutenberg custom block ranges as
  // typed `client_block` DraftBlocks. The remaining HTML between/around
  // them is parsed by the generic tokenizer below. This preserves the
  // structure for Superprof + future client plugins through a full
  // load/edit/save round-trip without lossy reformatting.
  const out: DraftBlock[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const found = parseGutenbergBlock(html, cursor);
    if (!found) {
      const tail = html.slice(cursor);
      out.push(...htmlToBlocksRaw(tail));
      break;
    }
    if (found.start > cursor) {
      out.push(...htmlToBlocksRaw(html.slice(cursor, found.start)));
    }
    out.push({
      id: uid(),
      type: "client_block",
      props: { instance: found.instance as ClientBlockInstance },
    } as DraftBlock);
    cursor = found.end;
  }
  return out;
}

function htmlToBlocksRaw(html: string): DraftBlock[] {
  if (!html || !html.trim()) return [];
  const tokens = tokenize(html);
  const blocks: DraftBlock[] = [];

  // Pending HTML comments / wp:* are accumulated in a `raw_html` block when
  // they precede non-block content; otherwise dropped if standalone.
  let pendingRaw: string[] = [];

  function flushRaw() {
    if (!pendingRaw.length) return;
    const raw = pendingRaw.join("").trim();
    pendingRaw = [];
    if (!raw) return;
    blocks.push({ id: uid(), type: "raw_html", props: { html: raw } });
  }

  for (const t of tokens) {
    if (t.tag === null) {
      // text or comment
      if (t.raw.trim().startsWith("<!--")) {
        pendingRaw.push(t.raw);
      } else {
        const txt = stripTags(t.raw).trim();
        if (txt) blocks.push({ id: uid(), type: "paragraph", content: txt });
      }
      continue;
    }
    flushRaw();
    const tag = t.tag;
    if (!BLOCK_TAGS.has(tag)) {
      blocks.push({ id: uid(), type: "raw_html", props: { html: t.raw } });
      continue;
    }
    if (tag === "p") {
      const inner = t.raw.replace(/^<p[^>]*>/i, "").replace(/<\/p>\s*$/i, "");
      blocks.push({ id: uid(), type: "paragraph", content: stripTags(inner) });
    } else if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(3, parseInt(tag[1], 10));
      const inner = t.raw.replace(/^<h\d[^>]*>/i, "").replace(/<\/h\d>\s*$/i, "");
      blocks.push({
        id: uid(),
        type: "heading",
        content: stripTags(inner),
        props: { level },
      });
    } else if (tag === "ul" || tag === "ol") {
      const itemType: BlockType =
        tag === "ul" ? "bulletListItem" : "numberedListItem";
      for (const item of listItems(t.raw)) {
        blocks.push({ id: uid(), type: itemType, content: stripTags(item) });
      }
    } else if (tag === "blockquote") {
      const inner = t.raw
        .replace(/^<blockquote[^>]*>/i, "")
        .replace(/<\/blockquote>\s*$/i, "");
      blocks.push({ id: uid(), type: "quote", content: stripTags(inner) });
    } else if (tag === "pre") {
      // unwrap one level of <code>
      const inner = t.raw
        .replace(/^<pre[^>]*>\s*(?:<code[^>]*>)?/i, "")
        .replace(/(?:<\/code>\s*)?<\/pre>\s*$/i, "");
      const language = attr(t.raw, "data-language") || attr(t.raw, "language") || "";
      blocks.push({
        id: uid(),
        type: "code",
        props: { language, raw: decodeEntities(inner) },
      });
    } else if (tag === "img") {
      blocks.push({
        id: uid(),
        type: "image",
        props: {
          url: attr(t.raw, "src") || "",
          alt: attr(t.raw, "alt") || "",
        },
      });
    } else if (tag === "figure") {
      // <figure><img …/><figcaption>…</figcaption></figure>
      const imgM = /<img[^>]+>/i.exec(t.raw);
      const capM = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(t.raw);
      if (imgM) {
        blocks.push({
          id: uid(),
          type: "image",
          props: {
            url: attr(imgM[0], "src") || "",
            alt: attr(imgM[0], "alt") || "",
            caption: capM ? stripTags(capM[1]) : undefined,
          },
        });
      } else {
        blocks.push({ id: uid(), type: "raw_html", props: { html: t.raw } });
      }
    } else if (tag === "table") {
      blocks.push({ id: uid(), type: "raw_html", props: { html: t.raw } });
    } else if (tag === "div") {
      blocks.push({ id: uid(), type: "raw_html", props: { html: t.raw } });
    }
  }
  flushRaw();
  return blocks;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineToHtml(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return escapeHtml(content);
  if (Array.isArray(content)) {
    // BlockNote-style inline content blocks
    return content
      .map((c: any) => {
        if (typeof c === "string") return escapeHtml(c);
        if (c?.type === "text") {
          let html = escapeHtml(c.text || "");
          const styles = c.styles || {};
          if (styles.bold) html = `<strong>${html}</strong>`;
          if (styles.italic) html = `<em>${html}</em>`;
          if (styles.code) html = `<code>${html}</code>`;
          if (styles.underline) html = `<u>${html}</u>`;
          return html;
        }
        if (c?.type === "link") {
          const inner = inlineToHtml(c.content || []);
          const href = c.href || "#";
          return `<a href="${escapeHtml(href)}">${inner}</a>`;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Serialise blocks to the HTML stored in WP. Lists are grouped: consecutive
 * bulletListItem (resp. numberedListItem) become a single <ul>/<ol>.
 */
export function blocksToHtml(blocks: DraftBlock[]): string {
  let out = "";
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bulletListItem" || b.type === "numberedListItem") {
      const tag = b.type === "bulletListItem" ? "ul" : "ol";
      out += `<${tag}>`;
      while (i < blocks.length && blocks[i].type === b.type) {
        out += `<li>${inlineToHtml(blocks[i].content)}</li>`;
        i++;
      }
      out += `</${tag}>`;
      continue;
    }
    if (b.type === "paragraph") {
      out += `<p>${inlineToHtml(b.content)}</p>`;
    } else if (b.type === "heading") {
      const level = Math.min(6, Math.max(1, Number(b.props?.level) || 2));
      out += `<h${level}>${inlineToHtml(b.content)}</h${level}>`;
    } else if (b.type === "checkListItem") {
      const checked = b.props?.checked ? " checked" : "";
      out += `<ul><li><input type="checkbox" disabled${checked}/> ${inlineToHtml(b.content)}</li></ul>`;
    } else if (b.type === "quote") {
      out += `<blockquote>${inlineToHtml(b.content)}</blockquote>`;
    } else if (b.type === "code") {
      const raw = String(b.props?.raw ?? "");
      const lang = String(b.props?.language ?? "");
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out += `<pre><code${cls}>${escapeHtml(raw)}</code></pre>`;
    } else if (b.type === "image") {
      const url = String(b.props?.url ?? "");
      const alt = String(b.props?.alt ?? "");
      const caption = b.props?.caption as string | undefined;
      const img = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"/>`;
      out += caption
        ? `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`
        : img;
    } else if (b.type === "client_block") {
      const inst = (b.props as any)?.instance as ClientBlockInstance | undefined;
      if (inst?.namespace) out += serializeGutenbergBlock(inst);
    } else if (b.type === "raw_html") {
      out += String(b.props?.html ?? "");
    } else if (b.type === "table") {
      // BlockNote table content shape: { type: "tableContent", rows: [{cells: [[…inline]]}] }
      const c: any = b.content;
      if (c?.rows && Array.isArray(c.rows)) {
        out += "<table>";
        for (const row of c.rows) {
          out += "<tr>";
          for (const cell of row.cells || []) out += `<td>${inlineToHtml(cell)}</td>`;
          out += "</tr>";
        }
        out += "</table>";
      }
    }
    i++;
  }
  return out;
}
