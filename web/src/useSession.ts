import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";
import { createSession } from "./api";

type ServerEvent =
  | { type: "agent.message"; content: Array<{ type: "text"; text: string }> }
  | { type: "agent.tool_use"; name: string; id?: string }
  | { type: "agent.tool_result"; tool_use_id?: string }
  | { type: "session.status_idle" }
  | { type: "session.status_running" }
  | { type: "error"; message: string }
  | { type: string; [k: string]: any };

export function useSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "connecting">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const currentAssistantId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await createSession();
        if (cancelled) return;
        setSessionId(id);

        const es = new EventSource(`/api/sessions/${id}/stream`);
        esRef.current = es;

        es.onopen = () => {
          setStatus("idle");
          setError(null);
        };
        es.onerror = () => {
          // EventSource reconnecte automatiquement après chaque fin de turn agent
          // (res.end côté serveur). On n'affiche l'erreur que si la connexion est
          // vraiment fermée (readyState === CLOSED).
          if (es.readyState === EventSource.CLOSED) {
            setError("Connexion au stream perdue");
          }
        };

        es.onmessage = (ev) => {
          let data: ServerEvent;
          try {
            data = JSON.parse(ev.data);
          } catch {
            return;
          }
          handleEvent(data);
        };
      } catch (err: any) {
        setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEvent(ev: ServerEvent) {
    switch (ev.type) {
      case "session.status_running":
        setStatus("running");
        break;
      case "session.status_idle":
        setStatus("idle");
        currentAssistantId.current = null;
        break;
      case "agent.message": {
        const text = (ev.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (!text) break;
        appendAssistantText(text);
        break;
      }
      case "agent.tool_use": {
        appendToolCall(ev.name);
        break;
      }
      case "agent.tool_result": {
        markLastToolDone();
        break;
      }
      case "error":
        setError((ev as any).message || "stream error");
        break;
      default:
        // ignore other event types (status updates, etc.)
        break;
    }
  }

  function ensureAssistantMessage(): string {
    if (currentAssistantId.current) return currentAssistantId.current;
    const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    currentAssistantId.current = id;
    setMessages((prev) => [
      ...prev,
      { id, role: "assistant", text: "", toolCalls: [] },
    ]);
    return id;
  }

  function appendAssistantText(text: string) {
    const id = ensureAssistantMessage();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.role === "assistant"
          ? { ...m, text: m.text + text }
          : m,
      ),
    );
  }

  function appendToolCall(name: string) {
    const id = ensureAssistantMessage();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.role === "assistant"
          ? { ...m, toolCalls: [...m.toolCalls, { name, status: "running" }] }
          : m,
      ),
    );
  }

  function markLastToolDone() {
    const id = currentAssistantId.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== id || m.role !== "assistant") return m;
        const idx = [...m.toolCalls].reverse().findIndex((t) => t.status === "running");
        if (idx === -1) return m;
        const realIdx = m.toolCalls.length - 1 - idx;
        const next = [...m.toolCalls];
        next[realIdx] = { ...next[realIdx], status: "done" };
        return { ...m, toolCalls: next };
      }),
    );
  }

  function appendUserMessage(text: string) {
    const id = `u_${Date.now()}`;
    setMessages((prev) => [...prev, { id, role: "user", text }]);
    currentAssistantId.current = null; // next agent.message starts a fresh bubble
  }

  return {
    sessionId,
    messages,
    status,
    error,
    appendUserMessage,
  };
}
