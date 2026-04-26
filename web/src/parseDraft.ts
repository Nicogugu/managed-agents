import type { WpDraft } from "./types";

const FENCE_RE = /```wp-post\s*\n([\s\S]*?)```/g;

export function extractDrafts(text: string): WpDraft[] {
  const drafts: WpDraft[] = [];
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
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

// Returns the same text but with the wp-post fences stripped (for clean rendering)
export function stripDraftFences(text: string): string {
  return text.replace(FENCE_RE, "").trim();
}
