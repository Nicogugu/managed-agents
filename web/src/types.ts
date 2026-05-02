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
