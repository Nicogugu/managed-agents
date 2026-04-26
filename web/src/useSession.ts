import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";
import { createSession } from "./api";

type ServerEvent =
  | { type: "agent.message"; content: Array<{ type: "text"; text: string }> }
  | {
      type: "agent.tool_use";
      name?: string;
      id?: string;
      input?: Record<string, any>;
      tool_use?: { name?: string; input?: Record<string, any> };
    }
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
  // Suivi du dernier event id reçu, pour reconnecter manuellement quand le
  // browser tue l'EventSource en arrière-plan (mobile en veille >2-3min)
  const lastEventIdRef = useRef<number>(0);
  const sessionIdRef = useRef<string | null>(null);
  // Queue de typewriter pour simuler du streaming token-par-token
  // (l'API Managed Agents v2 délivre agent.message d'un seul bloc)
  const typewriterQueue = useRef<string[]>([]);
  const typewriterRunning = useRef(false);
  // status_idle est différé tant que le typewriter n'a pas vidé sa queue,
  // sinon la ligne d'activité disparaît avant que tout le texte soit révélé.
  const pendingIdle = useRef(false);

  function connect(id: string) {
    esRef.current?.close();
    const last = lastEventIdRef.current;
    const url = last > 0
      ? `/api/sessions/${id}/stream?last_event_id=${last}`
      : `/api/sessions/${id}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => {
      setStatus((s) => (s === "connecting" ? "idle" : s));
      setError(null);
    };
    es.onerror = () => {
      // EventSource auto-reconnecte normalement ; on n'affiche l'erreur que
      // si la connexion est vraiment fermée (cas mobile en veille longue)
      if (es.readyState === EventSource.CLOSED) {
        setError("Connexion au stream perdue");
      }
    };
    es.onmessage = (ev) => {
      // EventSource expose ev.lastEventId pour le dernier id "event id" reçu
      if (ev.lastEventId) {
        const n = parseInt(ev.lastEventId, 10);
        if (n > 0) lastEventIdRef.current = n;
      }
      let data: ServerEvent;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(data);
    };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await createSession();
        if (cancelled) return;
        setSessionId(id);
        sessionIdRef.current = id;
        connect(id);
      } catch (err: any) {
        setError(err.message);
      }
    })();

    // Reconnexion proactive quand l'onglet redevient visible. Sur mobile, le
    // browser tue souvent l'EventSource après quelques minutes en arrière-plan
    // sans que l'auto-reconnect du browser réussisse. On force une reconnexion
    // depuis le dernier event id connu.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const id = sessionIdRef.current;
      const es = esRef.current;
      if (!id) return;
      if (!es || es.readyState === EventSource.CLOSED) {
        connect(id);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);

    return () => {
      cancelled = true;
      esRef.current?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEvent(ev: ServerEvent) {
    switch (ev.type) {
      case "session.status_running":
        setStatus("running");
        // Nouveau tour → on annule un éventuel idle différé d'un tour précédent
        pendingIdle.current = false;
        break;
      case "session.status_idle":
        if (typewriterRunning.current) {
          // Le texte n'est pas encore totalement révélé — on diffère le passage en idle
          pendingIdle.current = true;
        } else {
          setStatus("idle");
          currentAssistantId.current = null;
        }
        break;
      case "agent.message": {
        const text = (ev.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (!text) break;
        // L'API Managed Agents v2 ne stream pas les tokens (text arrive en bloc).
        // On simule un streaming rapide côté client pour rendre l'arrivée visible.
        enqueueTypewriterReveal(text);
        break;
      }
      case "agent.tool_use": {
        const name = (ev as any).name || (ev as any).tool_use?.name;
        const input = (ev as any).input || (ev as any).tool_use?.input;
        if (name) appendToolCall(name, input);
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

  function enqueueTypewriterReveal(text: string) {
    typewriterQueue.current.push(text);
    if (!typewriterRunning.current) {
      typewriterRunning.current = true;
      runNextReveal();
    }
  }

  function runNextReveal() {
    const next = typewriterQueue.current.shift();
    if (!next) {
      typewriterRunning.current = false;
      // Si on attendait un idle différé, l'appliquer maintenant
      if (pendingIdle.current) {
        pendingIdle.current = false;
        setStatus("idle");
        currentAssistantId.current = null;
      }
      return;
    }
    // Cible ~1500 chars/sec pour rester fluide même sur les longs textes.
    // On adapte la taille du chunk au volume pour que les très gros textes
    // (article 3000+ chars) ne mettent pas plus de ~2s à se révéler.
    const totalDurationMs = Math.min(2000, Math.max(400, next.length * 0.7));
    const TICK_MS = 30;
    const ticks = Math.max(1, Math.floor(totalDurationMs / TICK_MS));
    const charsPerTick = Math.max(2, Math.ceil(next.length / ticks));
    let pos = 0;
    const tick = () => {
      const end = Math.min(pos + charsPerTick, next.length);
      appendAssistantText(next.slice(pos, end));
      pos = end;
      if (pos < next.length) {
        setTimeout(tick, TICK_MS);
      } else {
        // Texte courant fini → enchaîne sur le suivant si la queue n'est pas vide
        runNextReveal();
      }
    };
    tick();
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

  function appendToolCall(name: string, input?: Record<string, any>) {
    const id = ensureAssistantMessage();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.role === "assistant"
          ? {
              ...m,
              toolCalls: [
                ...m.toolCalls,
                { name, status: "running", input },
              ],
            }
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
