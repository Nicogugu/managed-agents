import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";
import { createSession, sessionExists } from "./api";

const SESSION_STORAGE_KEY = "wp-editor.sessionId";

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
  // Timestamp du dernier event reçu, pour afficher "Réflexion (Ns)" et que
  // l'utilisateur voie que l'agent bosse vs qu'il est planté
  const [lastEventAt, setLastEventAt] = useState<number>(0);
  // Queue de typewriter pour simuler du streaming token-par-token
  // (l'API Managed Agents v2 délivre agent.message d'un seul bloc)
  const typewriterQueue = useRef<string[]>([]);
  const typewriterRunning = useRef(false);
  // Cancel handler du tick en cours — appelé quand un event non-texte arrive
  // pendant qu'on stream du texte, pour finir la révélation instantanément
  // avant d'ajouter le tool block (sinon le markdown se split entre 2 blocs).
  const typewriterFlushNow = useRef<(() => void) | null>(null);
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
      // Track activity timestamp pour afficher l'âge du silence côté UI
      setLastEventAt(Date.now());
      handleEvent(data);
    };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Réutilise la session précédente (localStorage) si elle existe encore
        // côté Anthropic — le serveur garde tout l'historique des events.
        // Sinon on en crée une nouvelle. Ça évite de "repartir à zéro" à
        // chaque reload / reconnexion mobile.
        let id: string | null = null;
        const stored =
          typeof localStorage !== "undefined"
            ? localStorage.getItem(SESSION_STORAGE_KEY)
            : null;
        if (stored && (await sessionExists(stored))) {
          id = stored;
        }
        if (!id) {
          id = await createSession();
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(SESSION_STORAGE_KEY, id);
          }
        }
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
      case "session.status_idle": {
        // Si la session est bloquée en attente d'un tool result (custom_tool_use,
        // tool_confirmation), on reste en mode "running" côté UI — le serveur
        // va dispatcher le tool puis Anthropic ré-emettra status_running.
        const stopReason = (ev as any).stop_reason?.type;
        if (stopReason === "requires_action") {
          break;
        }
        if (typewriterRunning.current) {
          // Le texte n'est pas encore totalement révélé — on diffère le passage en idle
          pendingIdle.current = true;
        } else {
          setStatus("idle");
          currentAssistantId.current = null;
        }
        break;
      }
      case "agent.message": {
        const text = (ev.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (!text) break;
        // Pour les events replayés (historique d'une session reprise), on insère
        // direct — typewriter ne sert à rien et serait extrêmement lent. Pour
        // les events live, typewriter pour simuler le streaming.
        if ((ev as any)._replayed) {
          appendAssistantText(text);
        } else {
          enqueueTypewriterReveal(text);
        }
        break;
      }
      case "agent.tool_use":
      case "agent.custom_tool_use": {
        const name = (ev as any).name || (ev as any).tool_use?.name;
        const input = (ev as any).input || (ev as any).tool_use?.input;
        if (name) {
          // Avant d'insérer un tool block, on finit la révélation de texte
          // en cours pour éviter que le markdown du block texte courant soit
          // splitté en deux quand on append le block tool puis du texte après.
          flushTypewriter();
          appendToolCall(name, input);
        }
        break;
      }
      case "agent.tool_result":
      case "user.custom_tool_result": {
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
      { id, role: "assistant", blocks: [] },
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
      typewriterFlushNow.current = null;
      if (pendingIdle.current) {
        pendingIdle.current = false;
        setStatus("idle");
        currentAssistantId.current = null;
      }
      return;
    }
    const totalDurationMs = Math.min(2000, Math.max(400, next.length * 0.7));
    const TICK_MS = 30;
    const ticks = Math.max(1, Math.floor(totalDurationMs / TICK_MS));
    const charsPerTick = Math.max(2, Math.ceil(next.length / ticks));
    let pos = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    typewriterFlushNow.current = () => {
      if (cancelled) return;
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Append tout le restant d'un coup pour finir le block texte courant
      if (pos < next.length) {
        appendAssistantText(next.slice(pos));
        pos = next.length;
      }
    };
    const tick = () => {
      if (cancelled) return;
      const end = Math.min(pos + charsPerTick, next.length);
      appendAssistantText(next.slice(pos, end));
      pos = end;
      if (pos < next.length) {
        timer = setTimeout(tick, TICK_MS);
      } else {
        runNextReveal();
      }
    };
    tick();
  }

  // Finit immédiatement la révélation en cours + vide la queue. Appelé avant
  // d'insérer un tool block ou une fin de turn, pour que le block texte
  // courant contienne sa version finale (sinon le markdown se splitte).
  function flushTypewriter() {
    if (typewriterFlushNow.current) typewriterFlushNow.current();
    while (typewriterQueue.current.length > 0) {
      const t = typewriterQueue.current.shift()!;
      appendAssistantText(t);
    }
    typewriterRunning.current = false;
    typewriterFlushNow.current = null;
  }

  // Texte: on append au dernier block "text" pour préserver l'ordre
  // chronologique tool/text/tool/text. Si le dernier block est un tool,
  // on push un nouveau block text.
  function appendAssistantText(text: string) {
    const id = ensureAssistantMessage();
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== id || m.role !== "assistant") return m;
        const last = m.blocks[m.blocks.length - 1];
        if (last?.type === "text") {
          return {
            ...m,
            blocks: [
              ...m.blocks.slice(0, -1),
              { type: "text", text: last.text + text },
            ],
          };
        }
        return { ...m, blocks: [...m.blocks, { type: "text", text }] };
      }),
    );
  }

  function appendToolCall(name: string, input?: Record<string, any>) {
    const id = ensureAssistantMessage();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.role === "assistant"
          ? {
              ...m,
              blocks: [
                ...m.blocks,
                { type: "tool", call: { name, status: "running", input } },
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
        // Trouve le dernier block tool en status running
        for (let i = m.blocks.length - 1; i >= 0; i--) {
          const b = m.blocks[i];
          if (b.type === "tool" && b.call.status === "running") {
            const next = [...m.blocks];
            next[i] = { type: "tool", call: { ...b.call, status: "done" } };
            return { ...m, blocks: next };
          }
        }
        return m;
      }),
    );
  }

  async function newSession() {
    esRef.current?.close();
    typewriterQueue.current = [];
    typewriterRunning.current = false;
    pendingIdle.current = false;
    lastEventIdRef.current = 0;
    currentAssistantId.current = null;
    setMessages([]);
    setError(null);
    setStatus("connecting");
    try {
      const id = await createSession();
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SESSION_STORAGE_KEY, id);
      }
      setSessionId(id);
      sessionIdRef.current = id;
      connect(id);
    } catch (err: any) {
      setError(err.message);
    }
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
    lastEventAt,
    appendUserMessage,
    newSession,
  };
}
