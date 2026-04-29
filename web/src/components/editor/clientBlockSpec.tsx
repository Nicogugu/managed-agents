import { createReactBlockSpec } from "@blocknote/react";
import { ClientBlockView } from "../../customBlocks/ClientBlockView";
import type { ClientBlockInstance } from "../../customBlocks/types";

/**
 * Generic BlockNote block type for ALL client custom Gutenberg blocks.
 * Stores the typed instance JSON in `props.instance` and renders via the
 * descriptor lookup. One BlockNote spec covers any number of clients.
 */
const ClientBlockBlock = createReactBlockSpec(
  {
    type: "clientBlock",
    propSchema: { instance: { default: "" as string } },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const json = (block.props as { instance: string }).instance;
      let instance: ClientBlockInstance | null = null;
      try {
        instance = json ? JSON.parse(json) : null;
      } catch {
        instance = null;
      }
      if (!instance?.namespace) {
        return (
          <div
            contentEditable={false}
            suppressContentEditableWarning
            style={{ padding: 8, color: "#f59e0b", fontSize: 12 }}
          >
            client_block sans payload
          </div>
        );
      }
      return (
        <ClientBlockView
          instance={instance}
          onChange={(next) => {
            editor.updateBlock(block.id, {
              props: { instance: JSON.stringify(next) },
            } as any);
          }}
        />
      );
    },
    toExternalHTML: ({ block }) => {
      // Fallback only — real serialization happens server-side via
      // serializeGutenbergBlock so we get the exact Gutenberg comment
      // format. This is shown if someone calls editor.blocksToFullHTML
      // client-side, which we don't do for publish.
      const json = (block.props as { instance: string }).instance;
      return <div data-client-block={json}></div>;
    },
  },
);

export const clientBlockBlockSpec = ClientBlockBlock;
