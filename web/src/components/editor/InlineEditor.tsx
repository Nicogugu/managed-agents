import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useMemo, useRef, useState } from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./editor.css";

import { editorSchema } from "./blockEditorSchema";
import { useAgentBlockOps, agentOpFlag } from "./useAgentBlockOps";
import { bnToDraft, draftToBN } from "./blockConvert";
import { customBlockDescriptors } from "../../customBlocks/registry";
import type { ClientBlockDescriptor } from "../../customBlocks/types";
import type { DraftBlock, PostMeta } from "../../contract";

/** Builds a slash-menu entry that inserts a fresh client block instance. */
function clientBlockSlashItem(editor: any, d: ClientBlockDescriptor) {
  return {
    title: d.label,
    subtext: d.namespace,
    aliases: [d.namespace, d.group || ""],
    group: d.group || "Custom",
    icon: <span style={{ fontSize: 16 }}>{d.icon}</span>,
    onItemClick: () => {
      const attrs: Record<string, any> = {};
      for (const a of d.attrs) {
        if (a.autogen === "uuid")
          attrs[a.name] =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2);
        else if (a.default !== undefined) attrs[a.name] = a.default;
      }
      const children = d.children
        ? Array.from({ length: Math.max(2, d.children.min ?? 2) }).map(
            (_, i) => {
              const cattrs: Record<string, any> = {};
              for (const a of d.children!.attrs) {
                if (a.autogen === "uuid")
                  cattrs[a.name] =
                    typeof crypto !== "undefined" && "randomUUID" in crypto
                      ? crypto.randomUUID()
                      : Math.random().toString(36).slice(2);
                else if (a.autogen === "index")
                  cattrs[a.name] = a.type === "boolean" ? false : i;
                else if (a.default !== undefined) cattrs[a.name] = a.default;
              }
              return { attrs: cattrs };
            },
          )
        : undefined;
      const instance = { namespace: d.namespace, attrs, children };
      const cur = editor.getTextCursorPosition?.();
      const refId = cur?.block?.id;
      const partial: any = {
        type: "clientBlock",
        props: { instance: JSON.stringify(instance) },
      };
      if (refId) editor.insertBlocks([partial], refId, "after");
      else editor.insertBlocks([partial], editor.document.at(-1)?.id, "after");
    },
  };
}

type Selection = { block_ids: string[] } | null;

interface Props {
  sessionId: string | null;
  /** Initial content (from a wp-post fence the user clicked "Editer" on). */
  seedHtml?: string | null;
  onMetaSnapshot: (meta: PostMeta) => void;
  onMetaPatch?: (patch: Partial<PostMeta>) => void;
  onOriginalSnapshot: (blocks: DraftBlock[] | null) => void;
  /** Per-block metadata snapshot (locked, edit timestamps). */
  onBlockMeta?: (
    bm: Record<
      string,
      { locked?: boolean; user_edited_at?: number; agent_edited_at?: number }
    >,
  ) => void;
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
  onBlockMeta,
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
      if (snap.blockMeta) onBlockMeta?.(snap.blockMeta);
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

  // Flush user edits to server (debounced) so the agent sees the live doc
  // on its next turn via DOC_STATE injection. We skip the flush during the
  // first 1.5s after mount to avoid pushing the empty initialContent over
  // a real persisted state arriving from SSE.
  const mountedAt = useRef(Date.now());
  const flushTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!editor || !sessionId) return;
    const handler = () => {
      // Skip if the change came from an agent op — otherwise we'd round-trip
      // the same blocks back to the server and incorrectly mark them as
      // user-edited in the next DOC_STATE injection.
      if (agentOpFlag.applying) return;
      if (Date.now() - mountedAt.current < 1500) return;

      // Defensive dedup pass — BlockNote's drag-drop on atom blocks
      // (clientBlock, rawHtml, image) sometimes leaves the source in
      // place AND adds a copy at the destination, producing a visible
      // duplicate. We detect either same-id duplicates (truly orphaned
      // copy) or back-to-back identical instance payloads, and remove
      // the offending block before flushing.
      const doc = editor.document;
      const seenIds = new Set<string>();
      const dupIds: string[] = [];
      let prevSig = "";
      for (const b of doc) {
        if (seenIds.has(b.id)) {
          dupIds.push(b.id);
          continue;
        }
        seenIds.add(b.id);
        if (b.type === "clientBlock") {
          const sig = (b.props as any)?.instance || "";
          if (sig && sig === prevSig) dupIds.push(b.id);
          prevSig = sig;
        } else {
          prevSig = "";
        }
      }
      if (dupIds.length > 0) {
        agentOpFlag.applying = true;
        try {
          editor.removeBlocks(dupIds);
        } finally {
          queueMicrotask(() => {
            agentOpFlag.applying = false;
          });
        }
      }

      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(async () => {
        flushTimer.current = null;
        try {
          const blocks = editor.document.map(bnToDraft);
          await fetch(`/api/sessions/${sessionId}/draft/blocks`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blocks }),
          });
        } catch {
          // Best-effort: silent. Next mutation will retry.
        }
      }, 1000);
    };
    const off = editor.onChange?.(handler);
    return () => {
      if (typeof off === "function") off();
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    };
  }, [editor, sessionId]);

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
      <BlockNoteView editor={editor} theme="dark" slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => {
            const defaults = getDefaultReactSlashMenuItems(editor);
            const customItems = customBlockDescriptors.map((d) =>
              clientBlockSlashItem(editor, d),
            );
            const all = [...defaults, ...customItems];
            const q = (query || "").toLowerCase().trim();
            if (!q) return all;
            return all.filter((it: any) =>
              [it.title, ...(it.aliases || [])]
                .filter(Boolean)
                .some((s: string) => s.toLowerCase().includes(q)),
            );
          }}
        />
      </BlockNoteView>
    </div>
  );
}
