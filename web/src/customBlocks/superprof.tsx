import type { ClientBlockDescriptor } from "./types";

/**
 * Superprof custom Gutenberg blocks. Each entry is the same schema the
 * server uses (namespace + attrs + children) plus UI metadata: label,
 * icon, optional render override.
 *
 * Onboarding a new client = create a new file mirroring this one.
 */

export const superprofDescriptors: ClientBlockDescriptor[] = [
  {
    namespace: "superprof/quote-block",
    label: "Citation Superprof",
    icon: "💬",
    group: "Superprof",
    attrs: [
      { name: "quote", label: "Citation", type: "textarea", required: true },
      { name: "citation", label: "Auteur, Source", type: "text" },
    ],
    render: ({ attrs }) => (
      <blockquote className="wp-block-superprof-quote-block">
        <p>{(attrs.quote as string) || "(citation vide)"}</p>
        {attrs.citation ? <cite>{attrs.citation as string}</cite> : null}
      </blockquote>
    ),
  },
  {
    namespace: "superprof/polls-block",
    label: "Sondage Superprof",
    icon: "📊",
    group: "Superprof",
    attrs: [
      { name: "pollId", type: "uuid", autogen: "uuid" },
      { name: "pollQuestion", label: "Question", type: "text", required: true },
    ],
    children: {
      itemNamespace: "poll/poll-item",
      addLabel: "+ Option",
      min: 2,
      max: 12,
      selfClosing: true,
      attrs: [
        { name: "choiceId", type: "uuid", autogen: "uuid" },
        { name: "choiceIndex", type: "number", autogen: "index" },
        { name: "choiceText", label: "Option", type: "text", required: true },
      ],
    },
    render: ({ attrs, children }) => (
      <div className="wp-block-superprof-polls-block">
        <p style={{ fontWeight: 600, margin: "0 0 6px" }}>
          {(attrs.pollQuestion as string) || "(question vide)"}
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(children || []).map((c, i) => (
            <li key={i}>{(c.attrs.choiceText as string) || "(option)"}</li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    namespace: "superprof/timeline-block",
    label: "Timeline Superprof",
    icon: "📅",
    group: "Superprof",
    wrapperClass: "wp-block-superprof-timeline-block timeline medium",
    attrs: [],
    children: {
      itemNamespace: "timeline/timeline-container",
      addLabel: "+ Étape",
      min: 1,
      max: 30,
      attrs: [
        { name: "itemDate", label: "Date", type: "text", required: true },
        { name: "itemTitle", label: "Titre", type: "text", required: true },
        { name: "itemDescription", label: "Description", type: "textarea" },
        { name: "itemColor", label: "Couleur du dot", type: "color", default: "#ff6363" },
        { name: "isLast", type: "boolean", autogen: "index" },
      ],
    },
    render: ({ children }) => (
      <div className="wp-block-superprof-timeline-block">
        {(children || []).map((c, i) => {
          const color = (c.attrs.itemColor as string) || "#ff6363";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                padding: "6px 0",
                borderBottom: i === (children?.length ?? 0) - 1 ? "none" : "1px solid #2e323a",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: color,
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color, fontSize: 13, fontWeight: 500 }}>
                  {(c.attrs.itemDate as string) || ""}
                </div>
                <div style={{ color: "#b4bcd0", fontSize: 14 }}>
                  {(c.attrs.itemTitle as string) || ""}
                </div>
                {c.attrs.itemDescription ? (
                  <div style={{ color: "#62666d", fontSize: 12, marginTop: 2 }}>
                    {c.attrs.itemDescription as string}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    ),
  },
];
