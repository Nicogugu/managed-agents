import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useMemo, useRef, useState } from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./editor.css";

import { editorSchema } from "./blockEditorSchema";
import { useAgentBlockOps } from "./useAgentBlockOps";
import { bnToDraft, draftToBN } from "./blockConvert";
import type { DraftBlock, PostMeta } from "../../contract";

type Selection = { block_ids: string[] } | null;

interface Props {
  sessionId: string | null;
  /** Initial content (from a wp-post fence the user clicked "Editer" on). */
  seedHtml?: string | null;
  onMetaSnapshot: (meta: PostMeta) => void;
  onMetaPatch?: (patch: Partial<PostMeta>) => void;
  onOriginalSnapshot: (blocks: DraftBlock[] | null) => void;
  onSelectionChange: (sel: Selection) => void;
  onReady: (handle: EditorHandle) => void;
}

export interface EditorHandle {
  getBlocks: () => DraftBlock[];
  getHTML: () => Promise<string>;
  setBlocks: (blocks: DraftBlock[]) => void;
  setHTML: (html: string) => Promise<void>;
  scrollToBlock: (id: string) => void;
  getSelectionBlockIds: () => string[];
}

/**
 * BlockNote-backed editor wired to the draft SSE stream. The agent's block_*
 * tools mutate the server projection which emits draft.op events; this
 * component applies them via useAgentBlockOps with rAF coalescing so streamed
 * appends produce one PM transaction per frame instead of one per token.
 *
 * The editor is also user-editable. Manual edits are NOT pushed back to the
 * server in this v2 — they only matter at publish time when blocksToFullHTML
 * is re-serialised.
 */
export function InlineEditor({
  sessionId,
  seedHtml,
  onMetaSnapshot,
  onMetaPatch,
  onOriginalSnapshot,
  onSelectionChange,
  onReady,
}: Props) {
  const editor = useCreateBlockNote({
    schema: editorSchema,
    initialContent: [{ type: "paragraph", content: "" }] as any,
  });

  // Hydrate from seed HTML on mount (when user opened the editor by clicking
  // "Edit inline" on a wp-post DraftCard).
  const seedApplied = useRef(false);
  useEffect(() => {
    if (seedApplied.current) return;
    if (!editor || !seedHtml || !seedHtml.trim()) return;
    seedApplied.current = true;
    void (async () => {
      try {
        const blocks = await editor.tryParseHTMLToBlocks(seedHtml);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document.map((b: any) => b.id), blocks);
        }
      } catch {
        editor.replaceBlocks(editor.document.map((b: any) => b.id), [
          { type: "rawHtml", props: { html: seedHtml } } as any,
        ]);
      }
    })();
  }, [editor, seedHtml]);

  // Highlight blocks the agent just touched for ~800ms.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touchedTimers = useRef<Map<string, number>>(new Map());
  function markTouched(id: string) {
    setTouched((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = touchedTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      setTouched((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      touchedTimers.current.delete(id);
    }, 800);
    touchedTimers.current.set(id, t);
  }

  useAgentBlockOps({
    editor,
    sessionId,
    onSnapshot: (snap) => {
      onMetaSnapshot(snap.meta);
      onOriginalSnapshot(snap.original ?? null);
    },
    onDocLoad: (op) => {
      onMetaSnapshot(op.meta);
      onOriginalSnapshot(op.blocks);
    },
    onMetaUpdate: (patch) => {
      onMetaPatch?.(patch);
    },
    onAgentTouch: markTouched,
  });

  // CSS hook for visual highlight
  useEffect(() => {
    const root = document.querySelector(".bn-editor");
    if (!root) return;
    root
      .querySelectorAll<HTMLElement>("[data-agent-edited]")
      .forEach((el) => el.removeAttribute("data-agent-edited"));
    for (const id of touched) {
      const el = root.querySelector<HTMLElement>(
        `.bn-block-outer[data-id="${id}"]`,
      );
      if (el) el.setAttribute("data-agent-edited", "true");
    }
  }, [touched]);

  // Track selection → propagate block ids upwards.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const sel = editor.getSelection?.();
      if (sel?.blocks?.length) {
        onSelectionChange({ block_ids: sel.blocks.map((b: any) => b.id) });
      } else {
        const cur = editor.getTextCursorPosition?.();
        if (cur?.block) onSelectionChange({ block_ids: [cur.block.id] });
        else onSelectionChange(null);
      }
    };
    const off = editor.onSelectionChange?.(handler);
    return () => {
      if (typeof off === "function") off();
    };
  }, [editor, onSelectionChange]);

  const handle = useMemo<EditorHandle>(
    () => ({
      getBlocks: () => editor.document.map(bnToDraft),
      getHTML: async () => await editor.blocksToFullHTML(editor.document),
      setBlocks: (blocks) => {
        editor.replaceBlocks(
          editor.document.map((b: any) => b.id),
          blocks.map(draftToBN),
        );
      },
      setHTML: async (html) => {
        const blocks = await editor.tryParseHTMLToBlocks(html);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document.map((b: any) => b.id), blocks);
        }
      },
      scrollToBlock: (id) => {
        const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      getSelectionBlockIds: () => {
        const sel = editor.getSelection?.();
        if (sel?.blocks?.length) return sel.blocks.map((b: any) => b.id);
        const cur = editor.getTextCursorPosition?.();
        return cur?.block ? [cur.block.id] : [];
      },
    }),
    [editor],
  );

  useEffect(() => {
    onReady(handle);
  }, [handle, onReady]);

  return (
    <div className="bn-shell">
      <BlockNoteView editor={editor} theme="dark" />
    </div>
  );
}
