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
};

export type Mode = "validate" | "auto";
