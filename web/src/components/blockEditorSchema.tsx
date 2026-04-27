import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * `rawHtml` block: fallback for content the server couldn't parse into a
 * known block type (Gutenberg comments, shortcodes, exotic HTML). Renders the
 * stored HTML read-only inside the editor; on serialise the editor takes the
 * `html` prop verbatim.
 */
const RawHtmlBlock = createReactBlockSpec(
  {
    type: "rawHtml",
    propSchema: { html: { default: "" as string } },
    content: "none",
  },
  {
    render: ({ block }) => {
      const html = (block.props as { html: string }).html;
      return (
        <div
          className="rawhtml-block"
          contentEditable={false}
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    },
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
  },
});
