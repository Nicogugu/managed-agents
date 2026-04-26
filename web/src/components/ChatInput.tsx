import { useEffect, useRef, useState } from "react";

export function ChatInput({
  sessionId,
  onSend,
}: {
  sessionId: string | null;
  onSend: (text: string) => Promise<void>;
}) {
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  async function handleSend() {
    if (!sessionId || !input.trim()) return;
    const text = input.trim();
    setInput("");
    await onSend(text);
  }

  return (
    <footer className="border-t border-border bg-bg-primary">
      <div className="max-w-3xl mx-auto p-3 sm:p-4">
        {textInputOpen ? (
          <>
            <div className="surface rounded-xl flex items-end gap-2 p-2 focus-within:border-border-strong transition-colors">
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent border-0 resize-none px-2 py-1.5 text-md placeholder:text-text-muted focus:outline-none min-h-[24px] max-h-[200px]"
                placeholder="Écrire à l'agent…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={!sessionId}
                rows={1}
                autoFocus
              />
              <button
                onClick={handleSend}
                disabled={!sessionId || !input.trim()}
                className="btn-primary self-end"
                aria-label="Envoyer"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7l10-4-3 10-2-4-5-2z" fill="currentColor" />
                </svg>
              </button>
            </div>
            <div className="mt-2 px-1 flex items-center justify-between text-xs text-text-muted">
              <button
                type="button"
                onClick={() => {
                  setTextInputOpen(false);
                  setInput("");
                }}
                className="hover:text-text-tertiary"
              >
                ← Mode boutons
              </button>
              <span className="hidden sm:inline">
                Entrée pour envoyer · Shift+Entrée pour saut de ligne
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between text-xs text-text-muted px-1">
            <span>Clique une option ci-dessus</span>
            <button
              type="button"
              onClick={() => setTextInputOpen(true)}
              className="hover:text-text-tertiary underline"
            >
              ✎ Écrire
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
