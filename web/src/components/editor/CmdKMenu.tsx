import { useEffect, useRef, useState } from "react";

interface Props {
  selectionBlockIds: string[];
  onSubmit: (prompt: string, preset?: string) => void;
}

const PRESETS: Array<{ key: string; label: string; prompt: string }> = [
  { key: "rewrite", label: "Reformuler", prompt: "Reformule cette sélection en gardant le sens." },
  { key: "shorten", label: "Raccourcir", prompt: "Raccourcis cette sélection sans perdre l'essentiel." },
  { key: "expand", label: "Développer", prompt: "Développe cette sélection avec plus de détails et d'exemples." },
  { key: "formal", label: "Plus formel", prompt: "Réécris cette sélection avec un ton plus formel." },
  { key: "casual", label: "Plus simple", prompt: "Réécris cette sélection dans un style plus simple et accessible." },
  { key: "fix", label: "Corriger", prompt: "Corrige les fautes d'orthographe et de grammaire de cette sélection." },
  { key: "translate-en", label: "→ English", prompt: "Translate this selection into English." },
  { key: "tldr", label: "TL;DR", prompt: "Résume cette sélection en une phrase." },
];

/**
 * Floating Cmd+K menu. Triggered by ⌘K (Mac) or Ctrl+K. Uses the current
 * cursor / multi-block selection as scope and forwards a structured selection
 * tag in the user message so the agent constrains its edits.
 */
export function CmdKMenu({ selectionBlockIds, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setText("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const filtered = PRESETS.filter(
    (p) => !text || p.label.toLowerCase().includes(text.toLowerCase()),
  );

  function submitPreset(p: (typeof PRESETS)[number]) {
    onSubmit(p.prompt, p.key);
    setOpen(false);
  }

  function submitFreeform() {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center pt-20 px-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="surface rounded-xl shadow-elevated w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-xs text-text-tertiary">
          <span>Demander à l'agent</span>
          {selectionBlockIds.length > 0 && (
            <span className="pill">
              {selectionBlockIds.length} bloc{selectionBlockIds.length > 1 ? "s" : ""} sélectionné
              {selectionBlockIds.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              if (filtered.length && text === "") submitPreset(filtered[active]);
              else submitFreeform();
            }
          }}
          placeholder={
            selectionBlockIds.length
              ? "Demander une modif sur la sélection…"
              : "Demander à l'agent…"
          }
          className="w-full bg-transparent border-0 px-4 py-3 text-md focus:outline-none placeholder:text-text-muted"
        />
        {filtered.length > 0 && (
          <div className="border-t border-border max-h-72 overflow-auto">
            {filtered.map((p, i) => (
              <button
                key={p.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => submitPreset(p)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  i === active ? "bg-bg-elevated" : "hover:bg-bg-tertiary"
                }`}
              >
                {p.label}
                <span className="ml-2 text-xs text-text-muted">{p.prompt}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
