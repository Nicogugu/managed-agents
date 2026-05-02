import type { WpPlan, TodoItem, WpAsk } from "./types";

const PLAN_RE = /```wp-plan\s*\n([\s\S]*?)```/g;
const TODOS_RE = /```todos\s*\n([\s\S]*?)```/g;
const ASK_RE = /```ask\s*\n([\s\S]*?)```/g;
const LOOSE_TODO_LINE = /^[ \t]*-[ \t]+\[([ x\-X])\][ \t]+(.+)$/;

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

export function stripBlocks(text: string): string {
  return text.replace(PLAN_RE, "").replace(TODOS_RE, "").replace(ASK_RE, "").trim();
}
