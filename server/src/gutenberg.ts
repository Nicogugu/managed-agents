import { randomUUID } from "node:crypto";
import type {
  BlockAttrSpec,
  ChildrenSpec,
  ClientBlockAttrs,
  ClientBlockChild,
  ClientBlockInstance,
  ClientBlockSchema,
} from "./customBlockSchema.js";
import {
  customBlockRegistry,
  defaultWrapperClass,
  getSchema,
} from "./customBlocks/registry.js";

/**
 * Generic parser + serializer for Gutenberg-style custom blocks.
 *
 * Format expected (per WP plugin convention):
 *   <!-- wp:NAMESPACE {ATTRS_JSON} -->
 *   <DOM…>
 *   <!-- /wp:NAMESPACE -->
 *
 * For repeatable children, the inner DOM contains nested comments:
 *   <!-- wp:CHILD_NS {ATTRS_JSON} -->
 *   <DOM…>
 *   <!-- /wp:CHILD_NS -->
 *
 * or, for self-closing children:
 *   <!-- wp:CHILD_NS {ATTRS_JSON} /-->
 */

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Detect the NEXT custom Gutenberg block opening at or after `from`.
 * Returns null if no known namespace matches.
 */
export function findNextCustomBlock(
  html: string,
  from: number,
): { start: number; end: number; namespace: string; attrs: ClientBlockAttrs; inner: string } | null {
  const re = /<!--\s*wp:([a-zA-Z0-9_/-]+)\s*(\{[\s\S]*?\})?\s*(\/?)-->/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const ns = m[1];
    if (!getSchema(ns)) continue; // not a registered top-level block, skip
    const attrs = (m[2] ? safeJsonParse(m[2]) : {}) as ClientBlockAttrs;
    const isSelfClose = m[3] === "/";
    const start = m.index;
    if (isSelfClose) {
      const end = m.index + m[0].length;
      return { start, end, namespace: ns, attrs, inner: "" };
    }
    // find matching closing comment
    const closeRe = new RegExp(
      `<!--\\s*/wp:${ns.replace(/[/]/g, "\\/")}\\s*-->`,
    );
    closeRe.lastIndex = re.lastIndex;
    const closeMatch = closeRe.exec(html.slice(re.lastIndex));
    if (!closeMatch) continue;
    const innerStart = re.lastIndex;
    const innerEnd = re.lastIndex + closeMatch.index;
    const end = innerEnd + closeMatch[0].length;
    return {
      start,
      end,
      namespace: ns,
      attrs,
      inner: html.slice(innerStart, innerEnd),
    };
  }
  return null;
}

/**
 * Parse all repeatable children of a given namespace inside a host's inner
 * HTML. Children come in two flavours: self-closing comments or
 * paired-with-DOM comments (matched lazily).
 */
function parseChildren(
  inner: string,
  spec: ChildrenSpec,
): ClientBlockChild[] {
  const ns = spec.itemNamespace;
  const out: ClientBlockChild[] = [];
  if (spec.selfClosing) {
    const re = new RegExp(
      `<!--\\s*wp:${ns.replace(/[/]/g, "\\/")}\\s*(\\{[\\s\\S]*?\\})?\\s*\\/-->`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      out.push({ attrs: m[1] ? (safeJsonParse(m[1]) as ClientBlockAttrs) : {} });
    }
    return out;
  }
  // Paired form
  const openRe = new RegExp(
    `<!--\\s*wp:${ns.replace(/[/]/g, "\\/")}\\s*(\\{[\\s\\S]*?\\})?\\s*-->`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(inner)) !== null) {
    const attrs = m[1] ? (safeJsonParse(m[1]) as ClientBlockAttrs) : {};
    out.push({ attrs });
    // Skip past the closing comment so we don't catch a nested same-ns
    // (rare but defensive). For Superprof timeline-container the children
    // don't nest themselves so OK.
    const closeRe = new RegExp(
      `<!--\\s*/wp:${ns.replace(/[/]/g, "\\/")}\\s*-->`,
    );
    closeRe.lastIndex = openRe.lastIndex;
    const closeMatch = closeRe.exec(inner.slice(openRe.lastIndex));
    if (closeMatch) openRe.lastIndex = openRe.lastIndex + closeMatch.index + closeMatch[0].length;
  }
  return out;
}

/**
 * High-level parse: returns null if no client block detected; otherwise
 * returns the typed block instance and the byte range.
 */
export function parseGutenbergBlock(
  html: string,
  from = 0,
): {
  start: number;
  end: number;
  instance: ClientBlockInstance;
} | null {
  const found = findNextCustomBlock(html, from);
  if (!found) return null;
  const schema = getSchema(found.namespace)!;
  const instance: ClientBlockInstance = {
    namespace: found.namespace,
    attrs: applyAttrDefaults(found.attrs, schema.attrs),
  };
  if (schema.children) {
    instance.children = parseChildren(found.inner, schema.children).map((c) => ({
      attrs: applyAttrDefaults(c.attrs, schema.children!.attrs),
    }));
  }
  return { start: found.start, end: found.end, instance };
}

function applyAttrDefaults(
  raw: ClientBlockAttrs,
  spec: BlockAttrSpec[],
): ClientBlockAttrs {
  const out: ClientBlockAttrs = { ...raw };
  for (const a of spec) {
    if (out[a.name] === undefined && a.default !== undefined) {
      out[a.name] = a.default;
    }
  }
  return out;
}

/** Generate a fresh attrs object respecting `autogen` + `default` rules. */
export function generateAttrs(
  spec: BlockAttrSpec[],
  index?: number,
): ClientBlockAttrs {
  const out: ClientBlockAttrs = {};
  for (const a of spec) {
    if (a.autogen === "uuid") out[a.name] = randomUUID();
    else if (a.autogen === "index" && typeof index === "number") {
      out[a.name] = a.type === "boolean" ? false : index;
    } else if (a.default !== undefined) {
      out[a.name] = a.default;
    }
  }
  return out;
}

/**
 * Serialize a typed instance back to the exact Gutenberg HTML string.
 *
 * The DOM rendering is intentionally generic and minimal — it produces
 * valid markup but not the FULL DOM that a hand-crafted plugin block
 * would. WP's Gutenberg validator works off the wp:NAMESPACE comment +
 * its attrs, NOT the inner DOM, so this is safe: WP re-renders from the
 * plugin code based on the attrs.
 *
 * For Superprof's timeline (which has hand-styled inline styles in the
 * sample we got), we fall back to a small renderer per namespace below
 * to keep the output close to the original. New clients can ride the
 * default renderer until they need anything special.
 */
export function serializeGutenbergBlock(instance: ClientBlockInstance): string {
  const schema = getSchema(instance.namespace);
  if (!schema) {
    return `<!-- wp:${instance.namespace} ${JSON.stringify(instance.attrs)} -->\n<!-- /wp:${instance.namespace} -->`;
  }
  const cls = schema.wrapperClass || defaultWrapperClass(instance.namespace);
  const renderer = INNER_DOM_RENDERERS[instance.namespace] || renderDefaultInner;
  const innerHtml = renderer(instance, schema, cls);
  // Drop empty attrs object to match WP's typical shorthand (`<!-- wp:foo -->`).
  const attrJson = Object.keys(instance.attrs).length ? " " + JSON.stringify(instance.attrs) : "";
  return `<!-- wp:${instance.namespace}${attrJson} -->\n${innerHtml}\n<!-- /wp:${instance.namespace} -->`;
}

type InnerRenderer = (
  instance: ClientBlockInstance,
  schema: ClientBlockSchema,
  cls: string,
) => string;

function renderDefaultInner(
  instance: ClientBlockInstance,
  schema: ClientBlockSchema,
  cls: string,
): string {
  if (schema.children) {
    const items = (instance.children || [])
      .map((c) => renderChild(schema.children!, c))
      .join("\n");
    return `<div class="${cls}">${items}</div>`;
  }
  // Simple key:value preview wrapped in the class.
  const fields = Object.entries(instance.attrs)
    .map(([k, v]) => `<p data-attr="${escapeHtml(k)}">${escapeHtml(String(v))}</p>`)
    .join("");
  return `<div class="${cls}">${fields}</div>`;
}

function renderChild(spec: ChildrenSpec, child: ClientBlockChild): string {
  const ns = spec.itemNamespace;
  const attrJson = Object.keys(child.attrs).length ? " " + JSON.stringify(child.attrs) : "";
  if (spec.selfClosing) {
    return `<!-- wp:${ns}${attrJson} /-->`;
  }
  // Paired form — minimal inner DOM
  return `<!-- wp:${ns}${attrJson} -->\n<div></div>\n<!-- /wp:${ns} -->`;
}

/** Per-namespace specialised renderers when WP expects specific markup. */
const INNER_DOM_RENDERERS: Record<string, InnerRenderer> = {
  "superprof/quote-block": (inst) => {
    const q = escapeHtml(String(inst.attrs.quote ?? ""));
    const c = escapeHtml(String(inst.attrs.citation ?? ""));
    return `<blockquote class="wp-block-superprof-quote-block"><p>${q}</p><cite>${c}</cite></blockquote>`;
  },
  "superprof/polls-block": (inst) => {
    const id = escapeHtml(String(inst.attrs.pollId ?? ""));
    const items = (inst.children || [])
      .map((c) => {
        const attrs = JSON.stringify(c.attrs);
        return `<!-- wp:poll/poll-item ${attrs} /-->`;
      })
      .join("\n\n");
    return `<div data-poll-id="${id}" class="wp-block-superprof-polls-block">${items}</div>`;
  },
  "superprof/timeline-block": (inst) => {
    const items = (inst.children || []);
    const last = items.length - 1;
    const renderItem = (c: ClientBlockChild, i: number) => {
      const date = escapeHtml(String(c.attrs.itemDate ?? ""));
      const title = escapeHtml(String(c.attrs.itemTitle ?? ""));
      const desc = escapeHtml(String(c.attrs.itemDescription ?? ""));
      const color = String(c.attrs.itemColor ?? "#ff6363");
      const isLast = i === last;
      const rowClass = `wp-block-timeline-timeline-container timeline-row${isLast ? " last" : ""}`;
      const attrs = { ...c.attrs, isLast: isLast || undefined };
      // Drop falsy isLast for non-last items (matches sample HTML)
      if (!isLast) delete (attrs as any).isLast;
      const attrJson = " " + JSON.stringify(attrs);
      return [
        `<!-- wp:timeline/timeline-container${attrJson} -->`,
        `<div class="${rowClass}"><div class="timeline-dot" style="background-color:${color}"></div><div class="timeline-date"><p class="timeline-date-item" style="color:${color};font-size:18px;text-align:left">${date}</p></div><div class="timeline-details"><p class="timeline-title" style="color:#888888;font-size:18px">${title}</p>${desc ? `<p class="timeline-description" style="color:#888888;font-size:16px">${desc}</p>` : ""}</div></div>`,
        `<!-- /wp:timeline/timeline-container -->`,
      ].join("\n");
    };
    return `<div class="wp-block-superprof-timeline-block timeline medium">${items.map(renderItem).join("\n")}</div>`;
  },
};

// Re-export for use by other modules.
export { customBlockRegistry, getSchema };
