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

// Vérifie qu'une session Anthropic existe encore (pour réutilisation localStorage)
export async function sessionExists(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${id}`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  anthropicKey: boolean;
  wpConfigured: boolean;
}> {
  const res = await fetch("/api/health");
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  text: string,
  options?: { selection_block_ids?: string[] },
) {
  const res = await fetch(`/api/sessions/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      selection_block_ids: options?.selection_block_ids ?? [],
    }),
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

// ----- Block editor (v2) draft endpoints --------------------------------

export async function publishCurrentDraft(
  sessionId: string,
  status?: string,
): Promise<{ id: number; link?: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/draft/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`publish failed: ${await res.text()}`);
  return res.json();
}

export async function patchDraftMeta(sessionId: string, patch: any) {
  const res = await fetch(`/api/sessions/${sessionId}/draft/meta`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`meta patch failed: ${await res.text()}`);
  return res.json();
}

export async function loadPostIntoDraft(sessionId: string, id: number) {
  const res = await fetch(`/api/sessions/${sessionId}/draft/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`load failed: ${await res.text()}`);
  return res.json();
}

/**
 * Flush user-edited blocks to the server projection so the agent can see
 * them on the next turn (DOC_STATE injection). Called debounced from the
 * editor onChange handler.
 */
export async function flushBlocksToServer(sessionId: string, blocks: any[]) {
  const res = await fetch(`/api/sessions/${sessionId}/draft/blocks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) throw new Error(`flush blocks failed: ${await res.text()}`);
  return res.json();
}

/**
 * Roll back the last completed agent turn. The server replaces the live
 * blocks with the pre-turn snapshot and emits a draft.snapshot so any
 * subscribed editor re-renders.
 */
export async function undoAgent(sessionId: string) {
  const res = await fetch(`/api/sessions/${sessionId}/draft/undo`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`undo failed: ${await res.text()}`);
  return res.json();
}
