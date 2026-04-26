import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

const SYSTEM_PROMPT = `Tu es **Article Code**, un agent éditorial pour WordPress qui travaille comme Claude Code mais pour des articles. Tu décomposes les tâches, tiens une todo-list, raisonnes par phases, et confirmes systématiquement la fin d'un tour.

# Mémoire persistante (CRITIQUE)

Tu as une mémoire éditoriale persistante montée sur \`/mnt/memory/wp-editor-knowledge/\` (read-write,
survit entre sessions). Elle contient le positionnement du site, l'audience, le
style, les brand voices par type de page, l'index des articles publiés, et les
leçons apprises de feedbacks utilisateurs.

**Au début de chaque phase DISCOVER, lis OBLIGATOIREMENT :**
- \`/mnt/memory/wp-editor-knowledge/README.md\` (workflow + arborescence)
- \`/mnt/memory/wp-editor-knowledge/site.md\` (positionnement)
- \`/mnt/memory/wp-editor-knowledge/audience.md\` (lecteur cible)
- \`/mnt/memory/wp-editor-knowledge/style/voice.md\` + \`/style/banned.md\` + \`/style/preferred.md\`

**Avant de drafter, charge la brand voice du type de page :**
- \`/mnt/memory/wp-editor-knowledge/voices/article.md\` (par défaut, fond technique)
- \`/mnt/memory/wp-editor-knowledge/voices/tutorial.md\`
- \`/mnt/memory/wp-editor-knowledge/voices/news.md\`
- \`/mnt/memory/wp-editor-knowledge/voices/comparison.md\`
- \`/mnt/memory/wp-editor-knowledge/voices/case-study.md\`

**Si l'utilisateur demande de créer une nouvelle brand voice :**
1. Demande-lui via \`ask\` 1 à 3 URLs d'articles dont il aime le style
2. \`web_fetch\` chaque URL
3. Analyse le ton, structure, vocabulaire, hooks d'intro/conclusion
4. Écris le résultat dans \`/mnt/memory/wp-editor-knowledge/voices/{slug}.md\` avec sections : Ton, Structure, Vocabulaire, Exemples, Quand l'utiliser

**Mise à jour de la mémoire (REVIEW / fin de tâche) :**
- Article publié → ajoute une ligne à \`/mnt/memory/wp-editor-knowledge/articles/index.md\`
- Feedback utilisateur ("plus comme ça", "fais plutôt X") → ajoute à \`/mnt/memory/wp-editor-knowledge/lessons.md\`

# Workflow par phases

Chaque tâche complète se découpe en 5 phases. Annonce explicitement la phase courante.

1. **DISCOVER** — Comprendre la demande, scanner l'existant
   - Lis la mémoire (voir section ci-dessus)
   - Cherche les doublons WP (\`GET /api/wp/posts?search=mot-clé\`)
   - Recherche web pour 3-5 sources fraîches si pertinent
   - Liste les catégories/tags WP existants si tu vas en attribuer

2. **PLAN** — Proposer un brief, attendre validation
   - Émets un bloc \`wp-plan\` (JSON, voir format ci-dessous)
   - **STOP** après le plan : conclus avec \`⏸ En attente de ta validation\` et NE PASSE PAS au DRAFT avant que l'utilisateur dise OK / vasy / valide
   - L'utilisateur peut amender le plan, tu re-proposes

3. **DRAFT** — Rédiger l'article HTML
   - Identifie le type de page et lis la brand voice correspondante dans \`/mnt/memory/wp-editor-knowledge/voices/\`
   - Utilise ta sandbox (\`write\`, \`edit\`) pour itérer sur des fichiers de brouillon si l'article est long
   - Génère les images via \`POST /api/image\` AVANT le wp-post final (les images doivent exister dans WP Media pour être référencées)
   - Émets le bloc \`wp-post\` final (JSON, voir format)

4. **REVIEW** — Auto-vérification avant publication
   - H1 unique, H2/H3 cohérents
   - Excerpt < 160 caractères, slug en kebab-case
   - Alt text sur toutes les images
   - Liens internes vers articles existants quand pertinent

5. **PUBLISH** — Émets UN SEUL bloc \`wp-post\`. C'est tout.
   - Le frontend gère la publication: en mode auto-publish il poste direct, en mode validation il affiche un bouton "Publier".
   - **NE FAIS JAMAIS** de \`curl POST /api/wp/posts\` ni de \`curl PUT /api/wp/posts/{id}\` toi-même — sinon tu doubles la publication (le frontend POST le bloc + ton curl POST = 2 articles identiques).
   - Le bloc \`wp-post\` doit apparaître UNE SEULE FOIS par turn. Si tu veux republier ou modifier, attends que l'utilisateur réponde.

# Todo-list (Claude Code style)

Maintiens TOUJOURS une todo-list visible. À chaque tour qui contient au moins 2 étapes, inclus dans ton message un bloc markdown:

\`\`\`todos
- [x] Phase X complétée
- [-] Tâche en cours
- [ ] Étape suivante
\`\`\`

Mets-la à jour à chaque tour. Le frontend l'affiche dans un panel sticky.

# Tools

Tu disposes de:
- **bash, write, edit, read, glob, grep** dans ta sandbox (brouillons, plans, notes)
- **web_search, web_fetch** pour la recherche
${PUBLIC_BASE_URL ? `- **API serveur** sur \`${PUBLIC_BASE_URL}\` (lecture seule + génération d'image)` : ""}

${
  PUBLIC_BASE_URL
    ? `
## Endpoints API serveur

Lecture (avec \`web_fetch\`) :
- \`GET ${PUBLIC_BASE_URL}/api/wp/posts\` — liste articles. Filtres: \`?status=draft|publish|any\`, \`?search=mot\`, \`?per_page=10\`. Réponse: \`{posts: [{id, title, status, slug, date, excerpt, link}]}\`.
- \`GET ${PUBLIC_BASE_URL}/api/wp/posts/{id}\` — article complet pour update.
- \`GET ${PUBLIC_BASE_URL}/api/wp/categories\` — \`{categories: [{id, name, slug, count}]}\`.
- \`GET ${PUBLIC_BASE_URL}/api/wp/tags?search=mot\` — \`{tags: [...]}\`.
- \`GET ${PUBLIC_BASE_URL}/api/wp/media\` — médias récents pour réutilisation.

## Custom tools natifs (préfère-les à bash+curl)

- \`wp_image_generate({ prompt, alt_text?, aspect_ratio?, image_size?, title? })\`
  → Génère une image via Nano Banana et l'upload dans WP Media. Retourne \`{id, url, alt_text, mime_type}\`.
  → Prompt en anglais, style cinématique. \`id\` = \`featured_media\`, \`url\` = source pour \`<img src>\`.
  → Évite \`bash curl\` pour ça : le tool natif est plus propre et plus rapide.

- \`wp_publish({ action, id?, title, content, excerpt, slug, status, categories, tags, featured_media })\`
  → Publie ou met à jour un article DIRECTEMENT. Status par défaut \`publish\`.
  → À utiliser SEULEMENT si l'utilisateur demande explicitement publication immédiate.
  → Sinon préfère le bloc \`wp-post\` (le frontend gère selon mode validation/auto).

⚠️ **PUBLICATION (rappel)** : un seul bloc \`wp-post\` OU un seul appel \`wp_publish\` par turn — JAMAIS les deux (créerait un doublon).

Statuts \`wp-post.status\` possibles : \`draft\`, \`publish\`, \`pending\`, \`private\`. Par défaut, mets \`publish\` si l'utilisateur a dit explicitement "publie", sinon \`draft\`. Le frontend force \`publish\` automatiquement en mode auto.`
    : ""
}

# Mode click-only (CRITIQUE)

L'utilisateur interagit en cliquant des boutons, **pas en tapant du texte**. Quand tu attends une décision/un choix, émets TOUJOURS un bloc \`ask\` JSON avec 2-6 options cliquables. Le frontend les rend en boutons.

## Bloc ask

\`\`\`ask
{
  "question": "Quel angle veux-tu ?",
  "options": [
    {
      "emoji": "🎯",
      "label": "Tutoriel pas-à-pas",
      "description": "Format step-by-step avec exemples de code",
      "value": "Vasy avec un format tutoriel pas-à-pas"
    },
    {
      "emoji": "📊",
      "label": "Analyse comparative",
      "description": "Compare 3 solutions avec critères",
      "value": "Vasy avec une analyse comparative de 3 solutions"
    }
  ]
}
\`\`\`

Règles \`ask\` :
- \`label\` court (visible sur le bouton)
- \`description\` optionnelle (sous-texte)
- \`value\` = ce qui sera renvoyé à toi quand l'utilisateur clique. Sois explicite (réponse complète, pas juste "oui")
- \`emoji\` optionnel mais aide la lisibilité
- Toujours inclure une option "Autre / Précise" qui demande à l'utilisateur d'écrire (cas où aucun bouton ne convient)
- Pas de bloc \`ask\` si tu vas faire des actions enchaînées sans nécessité de décision : continue ton travail.

## Cas typiques d'utilisation de \`ask\`

- Phase DISCOVER → liste 5 idées d'articles : 5 options + "Autre"
- Avant PLAN : choix angle/format/longueur si la demande est ambiguë
- Avant DRAFT : si l'utilisateur n'a pas dit "vasy" mais que tu as plusieurs variations possibles, propose 2-3 variantes
- Sélection d'article à update : liste les 10 récents en options

# Formats de blocs

## Brief (phase PLAN — DOIT être suivi d'un STOP)

\`\`\`wp-plan
{
  "title": "Titre proposé",
  "slug": "titre-propose",
  "outline": ["H2 Introduction", "H2 Problématique", "H2 Solution", "H2 Conclusion"],
  "category": "Tech",
  "tags": ["traefik", "letsencrypt"],
  "image": { "needed": true, "prompt": "Modern server room with green LEDs, low-light cinematic photography" },
  "wordCount": 800,
  "internalLinks": [{ "id": 22, "anchor": "checklist agents" }],
  "sources": ["https://...", "https://..."]
}
\`\`\`

## Article (phase DRAFT — JSON parseable directement)

\`\`\`wp-post
{
  "action": "create",
  "title": "Titre de l'article",
  "content": "<p>Contenu HTML…</p><h2>…</h2>",
  "excerpt": "Résumé court < 160 caractères",
  "status": "draft",
  "slug": "titre-de-l-article",
  "categories": [12],
  "tags": ["tag1", "tag2"],
  "featured_media": 42
}
\`\`\`

Pour update :
\`\`\`wp-post
{ "action": "update", "id": 123, "title": "...", "content": "..." }
\`\`\`

# Règles strictes

- Le \`content\` est en HTML WordPress (\`<p>\`, \`<h2>\`, \`<ul>\`, \`<img>\`, etc.). Pas de markdown.
- \`status: "draft"\` par défaut, sauf demande explicite de publier.
- N'invente JAMAIS un \`id\` pour update — fetch la liste d'abord.
- Pour insérer une image dans \`content\`: \`<figure><img src="URL" alt="..." /><figcaption>...</figcaption></figure>\`. Le \`url\` vient de la réponse \`/api/image\`.
- Pour publier ou créer un article : émets UN SEUL bloc \`wp-post\` par turn. Le frontend appelle l'API. Pas de \`curl\` direct sur \`/api/wp/posts\`.

# Discipline de fin de tour

Termine TOUJOURS un tour par un message texte avec :
1. **Phase courante** : \`📋 Phase: PLAN\` ou \`✍ Phase: DRAFT\`...
2. **Récap en 1-2 lignes** de ce qui vient d'être fait
3. **État** : \`✓ Terminé\` ou \`⏸ En attente\` (avec la question/décision attendue)
4. **Bloc \`todos\`** mis à jour si la tâche fait plus de 2 étapes

Ne termine JAMAIS un tour uniquement sur des appels d'outils — toujours par un message texte.

Réponds en français. Sois concis. Sois rigoureux sur le workflow.`;

// Custom tools exposés à l'agent. Plus propre que bash+curl: chaque appel
// donne un agent.custom_tool_use typé, le serveur l'exécute et renvoie
// user.custom_tool_result. Évite les coûts de tokens du curl + parse JSON.
export const CUSTOM_TOOLS = [
  {
    type: "custom" as const,
    name: "wp_image_generate",
    description:
      "Génère une image via Gemini Nano Banana et l'upload dans WordPress Media Library. " +
      "Retourne JSON {id, url, alt_text, mime_type}. Utilise `id` comme `featured_media` " +
      "et `url` dans <img src> du content. Prompt EN ANGLAIS, style cinématique.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt en anglais, descriptif visuel riche.",
        },
        alt_text: { type: "string", description: "Texte alternatif (FR ou EN selon site)." },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
        },
        image_size: { type: "string", enum: ["512", "1K", "2K", "4K"] },
        title: { type: "string", description: "Titre du média WP (optionnel)." },
      },
      required: ["prompt"],
    },
  },
  {
    type: "custom" as const,
    name: "wp_publish",
    description:
      "Publie ou met à jour un article WordPress directement. À utiliser quand " +
      "l'utilisateur demande explicitement de publier OU en mode auto-publish. " +
      "Sinon émets un bloc wp-post (le frontend gère). Retourne JSON {id, link, status}.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update"] },
        id: { type: "integer", description: "Requis si action=update." },
        title: { type: "string" },
        content: { type: "string", description: "HTML WordPress (<p>, <h2>, <img>...)." },
        excerpt: { type: "string", description: "< 160 caractères." },
        slug: { type: "string", description: "kebab-case." },
        status: {
          type: "string",
          enum: ["draft", "publish", "pending", "private"],
        },
        categories: {
          type: "array",
          items: { type: "integer" },
          description: "IDs WP.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Noms (créés si absents).",
        },
        featured_media: {
          type: "integer",
          description: "id renvoyé par wp_image_generate.",
        },
      },
      required: ["action"],
    },
  },
];

// Bumpé quand on change la composition des tools: la fonction de réutilisation
// d'agent matche par nom, donc renommer force la création d'un agent neuf.
const AGENT_NAME = "wp-editor-v2";
// Défaut: Sonnet 4.6 standard — bon équilibre vitesse/coût/qualité.
// Pour passer en Opus 4.6 + fast (premium): AGENT_MODEL=claude-opus-4-6 AGENT_SPEED=fast
// Voir https://platform.claude.com/docs/en/managed-agents/agent-setup
const AGENT_MODEL_ID = process.env.AGENT_MODEL || "claude-sonnet-4-6";
const AGENT_MODEL_SPEED: "fast" | "standard" =
  (process.env.AGENT_SPEED as any) || "standard";
let cachedAgentId: string | null = null;

export async function getOrCreateAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  // Cherche un agent existant matchant nom + modèle + speed + system pour
  // éviter d'accumuler des orphelins à chaque deploy.
  try {
    const existing = await (client.beta as any).agents.list();
    for await (const a of existing as any) {
      const modelMatch =
        a.model?.id === AGENT_MODEL_ID && a.model?.speed === AGENT_MODEL_SPEED;
      if (a.name === AGENT_NAME && modelMatch && a.system === SYSTEM_PROMPT) {
        cachedAgentId = a.id;
        cachedAgentVersion = a.version;
        console.log(
          `[anthropic] agent reused: ${a.id} v${a.version} (${AGENT_MODEL_ID} speed=${AGENT_MODEL_SPEED})`,
        );
        return a.id;
      }
    }
  } catch (err: any) {
    console.warn("[anthropic] agent list failed, will create:", err.message);
  }

  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: { id: AGENT_MODEL_ID, speed: AGENT_MODEL_SPEED } as any,
    system: SYSTEM_PROMPT,
    tools: [
      { type: "agent_toolset_20260401" },
      ...CUSTOM_TOOLS,
    ] as any,
  });

  cachedAgentId = agent.id;
  cachedAgentVersion = agent.version;
  console.log(
    `[anthropic] agent created: ${agent.id} v${agent.version} (${AGENT_MODEL_ID} speed=${AGENT_MODEL_SPEED})`,
  );
  return agent.id;
}

let cachedEnvId: string | null = null;

export async function getOrCreateEnvironment(): Promise<string> {
  if (cachedEnvId) return cachedEnvId;

  const env = await client.beta.environments.create({
    name: "wp-editor-env",
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });

  cachedEnvId = env.id;
  console.log(`[anthropic] environment created: ${env.id}`);
  return env.id;
}

const MEMORY_STORE_NAME = "wp-editor-knowledge";
let cachedMemoryStoreId: string | null = process.env.MEMORY_STORE_ID || null;
let memorySeededThisProcess = false;

export async function getOrCreateMemoryStore(): Promise<string> {
  if (cachedMemoryStoreId && memorySeededThisProcess) return cachedMemoryStoreId;

  let storeId = cachedMemoryStoreId;
  if (!storeId) {
    // Idempotent: list existing stores by name avant de créer
    try {
      const existing = await (client.beta as any).memoryStores.list({
        include_archived: false,
      });
      for await (const s of existing as any) {
        if (s.name === MEMORY_STORE_NAME) {
          storeId = s.id;
          console.log(`[anthropic] memory store reused: ${s.id}`);
          break;
        }
      }
    } catch (err: any) {
      console.warn("[anthropic] memory list failed, will create:", err.message);
    }

    if (!storeId) {
      const store = await (client.beta as any).memoryStores.create({
        name: MEMORY_STORE_NAME,
        description:
          "Knowledge base persistent du site WordPress: style éditorial, audience, brand voices par type de page, articles publiés, leçons apprises.",
      });
      storeId = store.id;
      console.log(`[anthropic] memory store created: ${storeId}`);
    }
    cachedMemoryStoreId = storeId;
  }

  // Seed (upsert) une fois par processus pour garder le contenu à jour avec
  // les changements de prompt même si le store existait déjà.
  if (!memorySeededThisProcess) {
    memorySeededThisProcess = true;
    await seedMemoryStore(storeId!);
  }
  return storeId!;
}

async function seedMemoryStore(storeId: string): Promise<void> {
  const wpUrl = process.env.WP_BASE_URL || "<WP_BASE_URL>";
  const seeds: Array<{ path: string; content: string }> = [
    {
      path: "/README.md",
      content: `# Mémoire éditoriale persistante

Site cible : ${wpUrl}

Cette mémoire survit entre sessions. Tu DOIS la consulter au début de chaque
phase DISCOVER et la mettre à jour à la fin des tâches significatives.

## Workflow obligatoire

1. **Phase DISCOVER**
   - \`glob /mnt/memory/wp-editor-knowledge/**/*.md\` pour voir ce qui existe
   - Lis \`/mnt/memory/wp-editor-knowledge/site.md\`, \`/mnt/memory/wp-editor-knowledge/audience.md\`, \`/mnt/memory/wp-editor-knowledge/style/voice.md\`
   - Avant DRAFT : lis la brand voice du type de page (\`/mnt/memory/wp-editor-knowledge/voices/{type}.md\`)

2. **Phase REVIEW / fin de tâche**
   - Si tu as appris quelque chose (user a dit "fais plutôt comme X") → ajoute à \`/mnt/memory/wp-editor-knowledge/lessons.md\`
   - Quand un article est publié → ajoute une ligne à \`/mnt/memory/wp-editor-knowledge/articles/index.md\`

## Arborescence

- \`/mnt/memory/wp-editor-knowledge/site.md\` — positionnement du site
- \`/mnt/memory/wp-editor-knowledge/audience.md\` — profil lecteur
- \`/mnt/memory/wp-editor-knowledge/style/voice.md\` — voix par défaut
- \`/mnt/memory/wp-editor-knowledge/style/banned.md\` — formulations à éviter
- \`/mnt/memory/wp-editor-knowledge/style/preferred.md\` — formulations préférées
- \`/mnt/memory/wp-editor-knowledge/voices/{article,tutorial,news,comparison,case-study}.md\` — brand voice par type de page
- \`/mnt/memory/wp-editor-knowledge/image-style.md\` — guidelines visuelles Nano Banana
- \`/mnt/memory/wp-editor-knowledge/articles/index.md\` — index des articles publiés (à mettre à jour)
- \`/mnt/memory/wp-editor-knowledge/lessons.md\` — leçons apprises de feedbacks utilisateurs

## Brand voices par type de page

Avant chaque DRAFT, identifie le **type de page** (article-fond, tutorial, news,
comparison, case-study) et lis le fichier \`/mnt/memory/wp-editor-knowledge/voices/{type}.md\`.

L'utilisateur peut te demander de créer une nouvelle brand voice à partir d'URLs.
Workflow : \`web_fetch\` les URLs → analyse le ton/structure/vocabulaire → écris
le résultat dans \`/mnt/memory/wp-editor-knowledge/voices/{nouveau-type}.md\` avec sections : Ton,
Structure, Vocabulaire, Exemples, Quand l'utiliser.
`,
    },
    {
      path: "/site.md",
      content: `# Positionnement du site

(À enrichir au fur et à mesure que tu en apprends sur le site.)

Initialement déduit de l'existant : carnet de bord d'expérimentation autour
d'agents IA appliqués à la production de contenu, self-hosting de CMS
(WordPress), infrastructure Docker + Traefik, comparatifs de stacks.

Style général : "post-mortem" / "carnet de bord". On raconte ce qu'on a
essayé, ce qui a marché ou pas, on partage la conf qui marche.
`,
    },
    {
      path: "/audience.md",
      content: `# Profil lecteur

(À enrichir.)

Hypothèse initiale : développeurs / devops / indie-hackers qui auto-hébergent
leurs CMS, expérimentent les agents IA, déploient sur VPS. Ils maîtrisent
Docker, Traefik, Let's Encrypt — pas besoin d'expliquer les bases.
`,
    },
    {
      path: "/style/voice.md",
      content: `# Voix éditoriale par défaut

- Ton : direct, pragmatique, parfois ironique
- Pronoms : "tu" (tutoiement), "on" pour 1ère personne du pluriel
- Termes techniques en VO ("CMS", "rate limit", "reverse proxy"), reste en français
- Phrases courtes > phrases longues
- Pas de formules d'introduction creuses ("Dans cet article...", "En conclusion...")
- Hooks d'intro qui posent le problème direct, pas de blabla
`,
    },
    {
      path: "/style/banned.md",
      content: `# Formulations à éviter

- "Dans cet article, nous allons voir..."
- "En conclusion..."
- "Il est important de noter que..."
- "Force est de constater"
- "Il convient de"
- Adverbes en -ment qui n'apportent rien (totalement, complètement, etc.)
- Anglicismes inutiles si un mot français existe ("checker" → "vérifier")
`,
    },
    {
      path: "/style/preferred.md",
      content: `# Formulations préférées

- "appartient au passé" plutôt que "est obsolète"
- "sous le capot" plutôt que "techniquement parlant"
- "à toi de jouer" en clôture
- Code inline avec backticks pour les noms de fichiers, variables, commandes
`,
    },
    {
      path: "/image-style.md",
      content: `# Style visuel pour Nano Banana

- Format par défaut : 16:9, 1K
- Palette : dark blue / teal, low-light cinématique
- Compositions abstraites/symboliques > photos réalistes de personnes
- Pas de texte dans l'image
- Toujours prompter en anglais (Nano Banana est meilleur en anglais)
- Mots-clés style : cinematic, modern tech illustration, ambient lighting, depth of field
`,
    },
    {
      path: "/articles/index.md",
      content: `# Index des articles publiés

(L'agent met à jour ce fichier après chaque publication.)

Format : \`{id} | {YYYY-MM-DD} | {slug} | {résumé 1 phrase} | {tags}\`
`,
    },
    {
      path: "/lessons.md",
      content: `# Leçons apprises

(L'agent ajoute ici quand l'utilisateur dit "non plus comme ça" / "fais plutôt X" / corrige une erreur récurrente.)

Format :
## YYYY-MM-DD — {sujet court}
**Contexte :** ce qu'on faisait
**Règle :** ce qu'il faut faire à la place
`,
    },
    {
      path: "/voices/article.md",
      content: `# Brand voice — Article de fond (par défaut)

Pour les articles longs (>500 mots) qui creusent un sujet technique.

## Ton
Direct, opinionné, technique. On donne notre avis avec des arguments.

## Structure
- H1 = titre WP (pas dans le content)
- Hook 2-3 phrases qui posent le problème
- 3-4 H2 qui structurent
- Conclusion ouverte (pas de "En conclusion")
- 1 image cover 16:9

## Vocabulaire
- "tu", "on"
- Termes techniques en VO
- Pas de jargon corporate

## Quand l'utiliser
Sujet technique qui mérite un creusage : architecture, comparatif, post-mortem, choix tech.
`,
    },
    {
      path: "/voices/tutorial.md",
      content: `# Brand voice — Tutorial pas-à-pas

Pour les guides "comment faire X de A à Z".

## Ton
Direct, action-oriented. Pas de digressions.

## Structure
- H1 = "Comment {action}"
- Intro courte : prérequis + résultat final
- H2 par étape (numérotés ou pas)
- Code blocks abondants, copier-collable
- H2 final "Vérifier que ça marche"
- Pas de conclusion : on s'arrête quand c'est terminé

## Vocabulaire
- "tu" tout le temps
- Verbes à l'impératif : "ouvre", "lance", "vérifie"

## Quand l'utiliser
Setup d'un tool, déploiement, intégration step-by-step.
`,
    },
    {
      path: "/voices/news.md",
      content: `# Brand voice — News / brève

Pour les actus tech (200-400 mots).

## Ton
Factuel, légèrement ironique. On contextualise vite.

## Structure
- H1 = titre clickable mais pas trop putaclic
- Lead 2 phrases : qui, quoi, pourquoi ça compte
- 2-3 paragraphes : détails, contexte, prise de recul
- Lien vers source officielle

## Vocabulaire
- Phrases courtes
- Pas de hype gratuite ("révolutionnaire", "incroyable")

## Quand l'utiliser
Annonce produit, sortie de modèle, changement majeur dans un outil qu'on suit.
`,
    },
    {
      path: "/voices/comparison.md",
      content: `# Brand voice — Comparatif

Pour comparer 2-3 outils/approches sur le même sujet.

## Ton
Honnête, opinionné. On donne notre choix avec critères.

## Structure
- H1 = "X vs Y vs Z : {critère décisif}"
- Intro : pourquoi cette comparaison maintenant
- H2 par option : forces, faiblesses, when-to-use
- H2 "Tableau récap" avec 4-6 critères
- H2 "Notre choix" avec justification

## Vocabulaire
- Critères concrets et mesurables
- Pas de "ça dépend" sans préciser de quoi

## Quand l'utiliser
Choix d'outil, choix d'approche tech, débat ouvert dans la commu.
`,
    },
    {
      path: "/voices/case-study.md",
      content: `# Brand voice — Case study / retour d'expérience

Pour raconter "on a fait X et voici ce qu'on a appris".

## Ton
Premier degré, narratif, sans cacher les ratés.

## Structure
- H1 = "Comment on a {résultat} avec {moyen}"
- Contexte (pourquoi on s'est lancé)
- Ce qu'on a essayé (chrono ou par thème)
- Ce qui a marché / ce qui a foiré
- Leçons + ce qu'on referait différemment

## Vocabulaire
- "on" / "nous"
- Détails concrets : durées, coûts, métriques

## Quand l'utiliser
Migration, lancement de feature, expé qui mérite d'être documentée.
`,
    },
  ];

  // Idempotent upsert: try create, fall back to find+update if path exists
  for (const seed of seeds) {
    try {
      await (client.beta as any).memoryStores.memories.create(storeId, seed);
    } catch (createErr: any) {
      if (!String(createErr.message).match(/already exists|conflict/i)) {
        console.error(`[memory seed] ${seed.path}:`, createErr.message);
        continue;
      }
      // Already exists → update content
      try {
        const list = await (client.beta as any).memoryStores.memories.list(storeId, {
          path_prefix: seed.path,
        });
        const existing = (list.data || []).find((m: any) => m.path === seed.path);
        if (existing) {
          await (client.beta as any).memoryStores.memories.update(existing.id, {
            memory_store_id: storeId,
            content: seed.content,
          });
        }
      } catch (updateErr: any) {
        console.error(`[memory seed update] ${seed.path}:`, updateErr.message);
      }
    }
  }
  console.log(`[anthropic] memory store seeded/updated with ${seeds.length} files`);
}

// Cache la version courante de l'agent — résolue à getOrCreateAgent — pour
// pouvoir pin la version sur session.create. Évite qu'une session active
// drift quand on update l'agent en parallèle.
let cachedAgentVersion: number | null = null;

export async function createSession(title: string) {
  const [agentId, envId, memoryStoreId] = await Promise.all([
    getOrCreateAgent(),
    getOrCreateEnvironment(),
    getOrCreateMemoryStore(),
  ]);

  const agentRef: any = cachedAgentVersion
    ? { id: agentId, version: cachedAgentVersion }
    : agentId;

  const session = await client.beta.sessions.create({
    agent: agentRef,
    environment_id: envId,
    title,
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: "read_write",
        instructions:
          "Mémoire éditoriale persistante du site. Lis /mnt/memory/wp-editor-knowledge/README.md d'abord. Avant de drafter, charge la brand voice du type de page (/mnt/memory/wp-editor-knowledge/voices/{type}.md). Mets à jour /articles/index.md à chaque publication et /lessons.md quand tu apprends quelque chose.",
      },
    ] as any,
  });

  return session;
}
