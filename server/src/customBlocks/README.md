# Onboarding d'un nouveau client (blocs Gutenberg custom)

Pour ajouter le support des blocs Gutenberg d'un nouveau client (ex : `acme/cta-block`), suivre ces 3 étapes :

## 1. Schéma serveur — `server/src/customBlocks/<client>.ts`

Décris la forme des attrs, les éventuels children (items répétables), le wrapper class si différent du défaut.

```ts
import type { ClientBlockSchema } from "../customBlockSchema.js";

export const acmeBlocks: ClientBlockSchema[] = [
  {
    namespace: "acme/cta-block",
    attrs: [
      { name: "title", label: "Titre", type: "text", required: true },
      { name: "url",   label: "Lien",  type: "text", required: true },
      { name: "color", label: "Couleur", type: "color", default: "#5e6ad2" },
    ],
  },
  {
    namespace: "acme/faq-block",
    attrs: [{ name: "title", label: "Titre", type: "text" }],
    children: {
      itemNamespace: "acme/faq-item",
      addLabel: "+ Question",
      attrs: [
        { name: "question", label: "Question", type: "text", required: true },
        { name: "answer",   label: "Réponse",   type: "textarea", required: true },
      ],
    },
  },
];
```

Puis l'append au registry :

```ts
// server/src/customBlocks/registry.ts
import { acmeBlocks } from "./acme.js";
export const customBlockRegistry = [...superprofBlocks, ...acmeBlocks];
```

## 2. Descripteur web — `web/src/customBlocks/<client>.tsx`

Reprends les MÊMES schémas (mêmes namespace/attrs/children) et ajoute UI metadata + fonction `render`.

```tsx
import type { ClientBlockDescriptor } from "./types";

export const acmeDescriptors: ClientBlockDescriptor[] = [
  {
    namespace: "acme/cta-block",
    label: "CTA Acme",
    icon: "🔘",
    group: "Acme",
    attrs: [
      { name: "title", label: "Titre", type: "text", required: true },
      { name: "url",   label: "Lien",  type: "text", required: true },
      { name: "color", label: "Couleur", type: "color", default: "#5e6ad2" },
    ],
    render: ({ attrs }) => (
      <a
        href={attrs.url as string}
        style={{
          display: "inline-block",
          padding: "8px 16px",
          background: attrs.color as string,
          color: "#fff",
          borderRadius: 4,
        }}
      >
        {(attrs.title as string) || "(CTA)"}
      </a>
    ),
  },
  // ...
];
```

Puis l'append au registry web :

```tsx
// web/src/customBlocks/registry.tsx
import { acmeDescriptors } from "./acme";
export const customBlockDescriptors = [...superprofDescriptors, ...acmeDescriptors];
```

## 3. (Optionnel) Renderer HTML spécifique

Si le rendu côté WP attend un DOM particulier (ex : la timeline Superprof avec ses `style="..."` inlines), ajouter un renderer dans `server/src/gutenberg.ts → INNER_DOM_RENDERERS`. Sinon le renderer par défaut produit un wrapper standard avec les attrs en `<p data-attr="...">` — le validator Gutenberg WP s'en fiche, il rerendre depuis les attrs JSON du commentaire.

## C'est tout

- Le slash menu de l'éditeur (`/`) liste automatiquement les nouveaux blocs.
- L'agent reçoit le schéma dans `DOC_STATE.client_block_schemas` et peut les insérer via `client_block_insert`.
- Le parser HTML round-trip détecte les commentaires `<!-- wp:NAMESPACE -->` connus et les recharge en blocs typés.
- Le serializer produit le HTML Gutenberg compatible WP.

Aucun autre code à toucher.
