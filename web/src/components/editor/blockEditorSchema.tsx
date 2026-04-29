import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { clientBlockBlockSpec } from "./clientBlockSpec";

/**
 * `rawHtml` block: fallback for content the server couldn't parse into a
 * known block type (Gutenberg comments, shortcodes, exotic HTML). Renders the
 * stored HTML read-only inside the editor; on save the server takes the
 * `html` prop verbatim.
 *
 * UX:
 * - Header with a "preview / source" toggle so the user can see the actual
 *   HTML the agent inserted (Gutenberg comments, attributes, etc.).
 * - In source mode the HTML is shown in a textarea — read-only for now;
 *   editing the raw HTML is a future iteration.
 * - The block is contentEditable=false (ProseMirror "atom"). To avoid the
 *   "click anywhere → block stays selected" trap when the rawHtml block is
 *   the last one in the doc, BlockNote/ProseMirror auto-adds a trailing
 *   paragraph; we also stop click propagation on the toggle button so it
 *   doesn't bubble up to the BlockNote selection handler.
 */
function RawHtmlView({ block }: { block: any }) {
  const [showSource, setShowSource] = useState(false);
  const html: string = (block.props as { html: string }).html || "";

  return (
    <div className="rawhtml-block" contentEditable={false} suppressContentEditableWarning>
      <div className="rawhtml-block__header">
        <span className="rawhtml-block__label">HTML brut</span>
        <button
          type="button"
          className="rawhtml-block__toggle"
          onClick={(e) => {
            e.stopPropagation();
            setShowSource((s) => !s);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {showSource ? "Aperçu" : "Voir le HTML"}
        </button>
      </div>
      {showSource ? (
        <textarea
          className="rawhtml-block__source"
          value={html}
          readOnly
          rows={Math.min(20, Math.max(3, html.split("\n").length))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="rawhtml-block__preview"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

const RawHtmlBlock = createReactBlockSpec(
  {
    type: "rawHtml",
    propSchema: { html: { default: "" as string } },
    content: "none",
  },
  {
    render: ({ block }) => <RawHtmlView block={block} />,
    toExternalHTML: ({ block }) => {
      const html = (block.props as { html: string }).html;
      return <div dangerouslySetInnerHTML={{ __html: html }} />;
    },
  },
);

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    rawHtml: RawHtmlBlock(),
    clientBlock: clientBlockBlockSpec(),
  },
});
