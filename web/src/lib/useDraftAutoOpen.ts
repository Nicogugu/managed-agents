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
        if (data.type === "draft.op") {
          // First op → open the editor. We don't care which.
          setShouldOpen(true);
          es.close();
          esRef.current = null;
        } else if (data.type === "draft.snapshot" && data.blocks?.length > 0) {
          // Reconnected after a refresh: the projection already has content.
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
