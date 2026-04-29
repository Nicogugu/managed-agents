import { useEffect, useRef } from "react";
import type { DraftBlock, PostMeta } from "../contract";

const KEY_PREFIX = "wp-editor-draft:";

interface Stored {
  meta: PostMeta;
  blocks: DraftBlock[];
  saved_at: number;
}

/**
 * Persists the current draft to localStorage every 2 s. The user can recover
 * after a crash via `loadStored(sessionId)`. Server is the source of truth, so
 * this is only a safety net for offline / crash recovery.
 */
export function useAutosave(
  sessionId: string | null,
  blocks: DraftBlock[],
  meta: PostMeta,
) {
  const last = useRef<string>("");
  useEffect(() => {
    if (!sessionId) return;
    const t = window.setInterval(() => {
      const payload: Stored = { meta, blocks, saved_at: Date.now() };
      const ser = JSON.stringify(payload);
      if (ser === last.current) return;
      last.current = ser;
      try {
        localStorage.setItem(KEY_PREFIX + sessionId, ser);
      } catch {
        // Quota exceeded → silently drop.
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [sessionId, blocks, meta]);
}

export function loadStored(sessionId: string): Stored | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export function clearStored(sessionId: string) {
  localStorage.removeItem(KEY_PREFIX + sessionId);
}
