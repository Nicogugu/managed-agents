import { useEffect, useMemo } from "react";
import type { DraftBlock } from "../../contract";
import type { EditorHandle } from "./InlineEditor";

interface Props {
  editor: EditorHandle | null;
  current: DraftBlock[];
  original: DraftBlock[] | null;
  onRevertBlock: (block: DraftBlock) => void;
}

type Diff = { added: Set<string>; modified: Set<string>; removedAfter: Map<string, DraftBlock[]> };

function hashContent(b: DraftBlock): string {
  return JSON.stringify({ type: b.type, content: b.content, props: b.props });
}

function computeDiff(current: DraftBlock[], original: DraftBlock[]): Diff {
  const origMap = new Map(original.map((b) => [b.id, b]));
  const curMap = new Map(current.map((b) => [b.id, b]));
  const added = new Set<string>();
  const modified = new Set<string>();
  for (const b of current) {
    const o = origMap.get(b.id);
    if (!o) added.add(b.id);
    else if (hashContent(o) !== hashContent(b)) modified.add(b.id);
  }
  // Removed blocks: those in original not in current. Group them by the
  // surviving block they used to follow, so we can show a "removed here" pill.
  const removedAfter = new Map<string, DraftBlock[]>();
  let lastSurvivor: string = "__top__";
  for (const o of original) {
    if (curMap.has(o.id)) {
      lastSurvivor = o.id;
      continue;
    }
    const arr = removedAfter.get(lastSurvivor) || [];
    arr.push(o);
    removedAfter.set(lastSurvivor, arr);
  }
  return { added, modified, removedAfter };
}

/**
 * Decorates editor blocks with `data-diff` attributes. Renders nothing visible
 * itself — diff styling is done via CSS. Provides accept/reject hooks.
 */
export function ReviewBadges({ editor: _editor, current, original, onRevertBlock }: Props) {
  const diff = useMemo<Diff | null>(
    () => (original ? computeDiff(current, original) : null),
    [current, original],
  );

  useEffect(() => {
    if (!diff) return;
    const root = document.querySelector(".bn-editor");
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-diff]").forEach((el) => el.removeAttribute("data-diff"));
    diff.added.forEach((id) => {
      const el = root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el) el.setAttribute("data-diff", "added");
    });
    diff.modified.forEach((id) => {
      const el = root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el) el.setAttribute("data-diff", "modified");
    });
  }, [diff, current]);

  if (!diff || (!diff.added.size && !diff.modified.size && !diff.removedAfter.size)) {
    return null;
  }

  const total = diff.added.size + diff.modified.size + diff.removedAfter.size;

  return (
    <div className="surface rounded-md p-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-text-tertiary">
        {total} bloc{total > 1 ? "s" : ""} modifié{total > 1 ? "s" : ""} ·{" "}
        {diff.added.size > 0 && <span className="text-emerald-400">+{diff.added.size}</span>}
        {diff.modified.size > 0 && <span className="text-amber-400 ml-1.5">~{diff.modified.size}</span>}
        {diff.removedAfter.size > 0 && (
          <span className="text-red-400 ml-1.5">-{diff.removedAfter.size}</span>
        )}
      </span>
      <button
        className="btn-ghost"
        onClick={() => {
          if (!original) return;
          original.forEach(onRevertBlock);
        }}
        title="Annuler toutes les modifs de l'agent"
      >
        Tout rejeter
      </button>
    </div>
  );
}
