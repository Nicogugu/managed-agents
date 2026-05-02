import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  selectionBlockIds: string[];
  allLocked: boolean;
  onAction: (prompt: string) => void;
  onToggleLock: () => void;
}

/**
 * Notion-style floating action bubble that follows the currently
 * selected block. Replaces the always-on quick action bar — only
 * surfaces when the user is actively focused on a block, and never
 * occupies vertical chrome when not needed.
 *
 * Positioning: anchored above the FIRST selected block via its
 * `data-id` attribute on the BlockNote DOM. Re-computed on scroll,
 * resize, and DOM mutations under the editor root.
 */
export function FloatingBlockActions({
  selectionBlockIds,
  allLocked,
  onAction,
  onToggleLock,
}: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (selectionBlockIds.length === 0) {
      setPos(null);
      return;
    }
    const id = selectionBlockIds[0];
    const root = document.querySelector(".bn-editor");

    const compute = () => {
      const el = root?.querySelector<HTMLElement>(
        `.bn-block-outer[data-id="${id}"]`,
      );
      if (!el) {
        setPos(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Anchor above the block, slightly inset from the left edge.
      setPos({
        top: Math.max(8, r.top - 38),
        left: Math.max(8, r.left + 8),
      });
    };
    compute();

    let raf: number | null = null;
    const schedule = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        compute();
      });
    };

    const obs = new MutationObserver(schedule);
    if (root) obs.observe(root, { childList: true, subtree: true, attributes: false });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);

    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [selectionBlockIds]);

  if (!pos || selectionBlockIds.length === 0) return null;

  const multi = selectionBlockIds.length > 1;

  const bubble = (
    <div
      className="fixed z-40 flex items-center gap-0.5 bg-bg-elevated border border-border rounded-md shadow-lg px-1 py-1 text-xs animate-[fadeIn_120ms_ease-out]"
      style={{ top: pos.top, left: pos.left }}
      role="toolbar"
      aria-label="Actions de bloc"
    >
      {multi && (
        <span className="text-text-tertiary px-1.5 select-none">
          {selectionBlockIds.length} blocs
        </span>
      )}
      <BubbleBtn label="Reformuler" icon="✦" onClick={() => onAction("Reformule ce bloc.")} />
      <BubbleBtn label="Raccourcir" icon="↓" onClick={() => onAction("Raccourcis ce bloc.")} />
      <BubbleBtn label="Allonger" icon="↑" onClick={() => onAction("Développe ce bloc.")} />
      <BubbleBtn
        label="Corriger"
        icon="✓"
        onClick={() => onAction("Corrige fautes et tournures de ce bloc.")}
      />
      <BubbleBtn
        label="Traduire en anglais"
        icon="🇬🇧"
        onClick={() => onAction("Traduis ce bloc en anglais.")}
      />
      <span className="w-px h-5 bg-border mx-0.5" />
      <BubbleBtn
        label={allLocked ? "Déverrouiller" : "Verrouiller"}
        icon={allLocked ? "🔓" : "🔒"}
        onClick={onToggleLock}
      />
    </div>
  );

  return createPortal(bubble, document.body);
}

function BubbleBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="px-1.5 py-0.5 rounded hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
    >
      {icon}
    </button>
  );
}
