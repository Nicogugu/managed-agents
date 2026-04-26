export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; toolCalls: ToolCall[] };

export type ToolCall = {
  name: string;
  status: "running" | "done";
  input?: Record<string, any>;
};

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

export type Mode = "validate" | "auto";
