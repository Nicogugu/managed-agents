import type { WpDraft, WpPlan, TodoItem, WpAsk } from "./types";

const POST_RE = /```wp-post\s*\n([\s\S]*?)```/g;
const PLAN_RE = /```wp-plan\s*\n([\s\S]*?)```/g;
const TODOS_RE = /```todos\s*\n([\s\S]*?)```/g;
const ASK_RE = /```ask\s*\n([\s\S]*?)```/g;
// Liste markdown libre: - [x|-| ] texte
const LOOSE_TODO_LINE = /^[ \t]*-[ \t]+\[([ x\-X])\][ \t]+(.+)$/;

export function extractDrafts(text: string): WpDraft[] {
  const drafts: WpDraft[] = [];
  let m: RegExpExecArray | null;
  POST_RE.lastIndex = 0;
  while ((m = POST_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && (parsed.action === "create" || parsed.action === "update")) {
        drafts.push(parsed);
      }
    } catch {
      // ignore invalid JSON; agent will retry
    }
  }
  return drafts;
}

export function extractPlans(text: string): WpPlan[] {
  const plans: WpPlan[] = [];
  let m: RegExpExecArray | null;
  PLAN_RE.lastIndex = 0;
  while ((m = PLAN_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed === "object") plans.push(parsed);
    } catch {
      // ignore
    }
  }
  return plans;
}

export function extractTodos(text: string): TodoItem[] {
  // Priorité: bloc ```todos```. Fallback: lignes "- [ ] ..." dans le texte libre.
  TODOS_RE.lastIndex = 0;
  const m = TODOS_RE.exec(text);
  const block = m ? m[1] : null;

  const items: TodoItem[] = [];
  const lines = (block || text).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(LOOSE_TODO_LINE);
    if (!match) continue;
    const mark = match[1].toLowerCase();
    const status: TodoItem["status"] =
      mark === "x" ? "done" : mark === "-" ? "in_progress" : "pending";
    items.push({ status, text: match[2].trim() });
  }
  return items;
}

export function extractAsks(text: string): WpAsk[] {
  const asks: WpAsk[] = [];
  let m: RegExpExecArray | null;
  ASK_RE.lastIndex = 0;
  while ((m = ASK_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
        asks.push({
          question: parsed.question,
          options: parsed.options
            .filter((o: any) => o && typeof o.label === "string" && typeof o.value === "string")
            .map((o: any) => ({
              label: o.label,
              value: o.value,
              emoji: o.emoji,
              description: o.description,
            })),
        });
      }
    } catch {
      // ignore
    }
  }
  return asks;
}

// Returns the text with wp-post / wp-plan / todos / ask fences stripped (for clean bubble rendering).
export function stripBlocks(text: string): string {
  return text
    .replace(POST_RE, "")
    .replace(PLAN_RE, "")
    .replace(TODOS_RE, "")
    .replace(ASK_RE, "")
    .trim();
}

// Backwards-compat alias used by existing callers
export const stripDraftFences = stripBlocks;
