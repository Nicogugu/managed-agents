import type { ClientBlockSchema } from "../customBlockSchema.js";

export const superprofBlocks: ClientBlockSchema[] = [
  {
    namespace: "superprof/quote-block",
    attrs: [
      { name: "quote", label: "Citation", type: "textarea", required: true },
      { name: "citation", label: "Auteur, Source", type: "text" },
    ],
  },
  {
    namespace: "superprof/polls-block",
    attrs: [
      { name: "pollId", type: "uuid", autogen: "uuid" },
      { name: "pollQuestion", label: "Question", type: "text", required: true },
    ],
    children: {
      itemNamespace: "poll/poll-item",
      addLabel: "+ Ajouter une option",
      min: 2,
      max: 12,
      selfClosing: true,
      attrs: [
        { name: "choiceId", type: "uuid", autogen: "uuid" },
        { name: "choiceIndex", type: "number", autogen: "index" },
        { name: "choiceText", label: "Option", type: "text", required: true },
      ],
    },
  },
  {
    namespace: "superprof/timeline-block",
    attrs: [],
    wrapperClass: "wp-block-superprof-timeline-block timeline medium",
    children: {
      itemNamespace: "timeline/timeline-container",
      addLabel: "+ Ajouter une étape",
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
  },
];
