export type ToolCall = {
  name: string;
  status: "running" | "done";
  input?: Record<string, any>;
};

export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "tool"; call: ToolCall };

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; blocks: MessageBlock[] };

export function assistantText(m: ChatMessage): string {
  if (m.role !== "assistant") return "";
  return m.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

export function assistantToolCalls(m: ChatMessage): ToolCall[] {
  if (m.role !== "assistant") return [];
  return m.blocks.flatMap((b) => (b.type === "tool" ? [b.call] : []));
}

export type WpDraft = {
  action: "create" | "update";
  id?: number;
  title?: string;
  content?: string;
  excerpt?: string;
  status?: "publish" | "draft" | "pending" | "private";
  slug?: string;
  categories?: number[];
  tags?: (number | string)[];
  featured_media?: number;
};

export type WpPlan = {
  title?: string;
  slug?: string;
  outline?: string[];
  category?: string;
  tags?: string[];
  image?: { needed?: boolean; prompt?: string };
  wordCount?: number;
  internalLinks?: Array<{ id: number; anchor?: string }>;
  sources?: string[];
  [k: string]: any;
};

export type TodoItem = {
  status: "pending" | "in_progress" | "done";
  text: string;
};

export type AskOption = {
  label: string;
  value: string;
  emoji?: string;
  description?: string;
};

export type WpAsk = {
  question?: string;
  options: AskOption[];
};

export type Mode = "validate" | "auto";

// État de publication d'un draft (auto-publish ou modal)
export type PublishState =
  | { status: "pending" }
  | { status: "published"; id: number; link: string }
  | { status: "error"; error: string };
