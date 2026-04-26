import type { WpDraft } from "./types";

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error && data?.detail) return `${data.error} — ${data.detail}`;
    if (data?.error) return data.error;
    if (data?.detail) return data.detail;
    return JSON.stringify(data);
  } catch {
    return await res.text();
  }
}

export async function createSession(title = "Chat session"): Promise<string> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`${res.status} · ${await readError(res)}`);
  const data = await res.json();
  return data.id as string;
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  anthropicKey: boolean;
  wpConfigured: boolean;
}> {
  const res = await fetch("/api/health");
  return res.json();
}

export async function sendMessage(sessionId: string, text: string) {
  const res = await fetch(`/api/sessions/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`);
}

export async function interrupt(sessionId: string) {
  await fetch(`/api/sessions/${sessionId}/interrupt`, { method: "POST" });
}

export async function publishDraft(draft: WpDraft) {
  const { action, id, ...payload } = draft;
  if (action === "update") {
    if (!id) throw new Error("update requires id");
    const res = await fetch(`/api/wp/posts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WP update failed: ${await res.text()}`);
    return res.json();
  }
  const res = await fetch(`/api/wp/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`WP create failed: ${await res.text()}`);
  return res.json();
}
