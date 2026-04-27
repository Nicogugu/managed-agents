import { useEffect, useRef, useState } from "react";

/**
 * Listens to /api/sessions/:id/draft/stream just enough to detect the FIRST
 * draft.op event from the agent (block_*, doc_init, doc_load…). When seen,
 * flips `shouldOpen` to true so the App auto-opens the editor pane.
 *
 * This is independent from the editor's own SSE consumption (which mounts
 * its own EventSource) — we only watch passively to drive the layout.
 */
export function useDraftAutoOpen(sessionId: string | null): { shouldOpen: boolean; reset: () => void } {
  const [shouldOpen, setShouldOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/sessions/${sessionId}/draft/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Only open on an active draft.op (i.e. the agent just emitted a
        // block_* tool right now). Don't auto-open from a stale snapshot —
        // server keeps the projection in memory across sessions and that
        // would always pop the editor open on reload, even if unused.
        if (data.type === "draft.op") {
          setShouldOpen(true);
          es.close();
          esRef.current = null;
        }
      } catch {}
    };
    es.onerror = () => {
      // Silent — the editor's own SSE will surface real errors.
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionId]);

  return {
    shouldOpen,
    reset: () => setShouldOpen(false),
  };
}
