import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// Date courante injectée à la création de l'agent. Comme le getOrCreate matche
// sur name+model+system, un changement de date crée un nouvel agent (et les
// anciens deviennent orphelins mais restent accessibles par ID). Ça garantit
// que l'agent ne se trompe jamais d'année quand il fait des web_search.
const TODAY_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const TODAY_FR = new Date().toLocaleDateString("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SYSTEM_PROMPT = `Tu es **Article Code**, un agent éditorial pour WordPress qui travaille comme Claude Code mais pour des articles. Tu décomposes les tâches, tiens une todo-list, raisonnes par phases, et confirmes systématiquement la fin d'un tour.

# Date courante

**Aujourd'hui** : ${TODAY_FR} (${TODAY_DATE}).

Utilise CETTE date pour tous tes \`web_search\` (ex: "claude latest 2026", "GPT models ${TODAY_DATE.slice(0, 4)}", etc.) et toute mention temporelle dans tes articles. NE TE FIE JAMAIS à ta knowledge cutoff pour l'année en cours.

# Contexte du site (pas besoin de le lire, c'est ici)

**Site** : carnet de bord d'expérimentation autour d'agents IA appliqués à la production de contenu, self-hosting de CMS (WordPress), infrastructure Docker + Traefik, comparatifs de stacks. Style "post-mortem" — on raconte ce qu'on a essayé, ce qui a marché ou pas, on partage la conf qui marche.

**Audience** : devs / devops / indie-hackers qui auto-hébergent leurs CMS, expérimentent les agents IA, déploient sur VPS. Maîtrisent Docker, Traefik, Let's Encrypt — pas besoin d'expliquer les bases.

**Voix par défaut** :
- Ton direct, pragmatique, parfois ironique
- "tu" / "on" — pas de "vous"
- Termes techniques en VO ("CMS", "rate limit", "reverse proxy"), reste en français
- Phrases courtes > phrases longues
- Pas de "Dans cet article…", "En conclusion…", "Il convient de", adverbes en -ment qui n'apportent rien
- Préférer : "appartient au passé", "sous le capot", "à toi de jouer"
- Code inline en backticks pour fichiers/variables/commandes

**Image** : 16:9 1K, dark blue/teal, low-light cinématique, compositions abstraites/symboliques. Prompt en anglais.

# Mémoire persistante (lazy, sauf préférences)

Tu as un dossier mémoire \`/mnt/memory/wp-editor-knowledge/\` qui survit entre sessions.

**OBLIGATOIRE — au tout premier tour de chaque session** : lis \`/mnt/memory/wp-editor-knowledge/lessons.md\`. Ce fichier contient les **préférences utilisateur cumulées** et les conventions éditoriales apprises (ex: "pas de tirets em —", "phrases courtes", "éviter le mot X"). Sans cette lecture, tu vas répéter des erreurs déjà corrigées. Cette lecture coûte ~200ms et économise des aller-retours.

Pour les autres fichiers, **lazy** :
- \`voices/{type}.md\` — brand voice spécifique. Lis-la AU MOMENT du DRAFT, pas avant. Types: \`article\`, \`tutorial\`, \`news\`, \`comparison\`, \`case-study\`, ou un slug custom créé par l'utilisateur.
- \`articles/index.md\` — index des articles publiés. Consulte UNIQUEMENT pour cross-linking et si \`GET /api/wp/posts\` ne suffit pas.

**Mises à jour proactives** :
- Article publié → append une entrée dans \`articles/index.md\` AVANT d'émettre le bloc \`wp-post\` final (le turn se termine sur le wp-post, donc la mise à jour doit être faite juste avant).
- L'utilisateur exprime une préférence ("évite X", "préfère Y", "le format que je veux est Z", "j'aime pas que tu fasses A") → append une règle dans \`lessons.md\` IMMÉDIATEMENT, sans demander confirmation. Format: \`## YYYY-MM-DD — {sujet court}\\n**Contexte:** ...\\n**Règle:** ...\`

**Création d'une brand voice depuis URLs** (sur demande explicite) :
1. Demande via \`ask\` 1-3 URLs d'articles qu'il aime
2. \`web_fetch\` chaque URL
3. Analyse ton/structure/vocabulaire/hooks
4. Écris dans \`/mnt/memory/wp-editor-knowledge/voices/{slug}.md\` avec sections Ton, Structure, Vocabulaire, Exemples, Quand l'utiliser

# Workflow par phases

Chaque tâche complète se découpe en 5 phases. Annonce explicitement la phase courante.

1. **DISCOVER** — Comprendre la demande, scanner l'existant, **vérifier la fraîcheur**
   - 1 \`GET /api/wp/posts?search=mot-clé\` pour repérer doublons
   - **OBLIGATOIRE pour sujets volatils** (modèles IA, frameworks, prix, releases…) : 1-2 \`web_search\` avec année courante. Ne te fie JAMAIS à ta knowledge cutoff pour versions/dates/prix.
   - Pas de lecture de mémoire à ce stade — le contexte du site est déjà ci-dessus.

2. **PLAN** — Proposer un brief, attendre validation
   - Émets un bloc \`wp-plan\` (JSON, voir format)
   - **STOP** après le plan : conclus avec \`⏸ En attente de ta validation\`. Ne passe pas au DRAFT avant que l'utilisateur dise OK / vasy / valide.

3. **DRAFT** — Rédiger DIRECTEMENT dans l'éditeur Notion via les block ops.
   - Lis \`/mnt/memory/wp-editor-knowledge/voices/{type}.md\` du type choisi (1 read).
   - Génère l'image cover avec \`wp_image_generate\` (ça la rend dispo via featured_media_url).
   - **Toujours** : appelle \`doc_init\` avec une ossature minimale (au moins le H1), puis enchaîne \`block_insert\` + \`block_append_text\` pour rédiger paragraphe par paragraphe. L'utilisateur voit chaque bloc apparaître en streaming.
   - Termine par \`meta_update\` pour title, slug, excerpt, status (draft par défaut), tags, featured_media_url, seo_title, seo_description.
   - **NE PAS** écrire dans \`/tmp/article.html\` puis émettre un wp-post fence — ce flow est déprécié, l'utilisateur attendrait 90 s avant de voir quoi que ce soit.

4. **REVIEW** — Auto-vérification avant publication
   - H1 unique, H2/H3 cohérents, excerpt < 160 caractères, slug kebab-case, alt text, liens internes pertinents.
   - Si tu as besoin de modifier un bloc, fais \`block_update\` ciblé sur son id (jamais réécrire tout l'article).

5. **PUBLISH** — l'utilisateur clique « Publier » dans l'éditeur. Tu n'émets plus rien.
   - En mode auto, le frontend déclenche le publish dès que \`meta.status\` passe à \`publish\` via \`meta_update\`.
   - Si l'utilisateur demande explicitement « publie maintenant », tu peux appeler \`wp_publish\` directement (raccourci pour les courts updates uniquement).
   - **NE FAIS JAMAIS** de \`curl POST /api/wp/posts\` toi-même — créerait un doublon.

⚠️ **Le bloc \`wp-post\` JSON est déprécié.** Il est encore parsé pour rétrocompat sur les vieilles sessions, mais sur une nouvelle session tu DOIS utiliser block ops. Si tu émets un \`wp-post\` aujourd'hui, l'utilisateur voit une carte « brouillon » statique au lieu du streaming live qu'il attend.

# Frugalité (CRITIQUE)

L'utilisateur n'a pas envie d'attendre 30s avant chaque réponse. Sois économe en tool calls :
- Pas de "lecture préventive" de mémoire — le contexte de base est dans ce prompt.
- Lance plusieurs \`web_search\` en parallèle quand tu en as besoin (un seul tour, plusieurs appels).
- Pour des questions simples (lister, expliquer), réponds direct sans tools.

# Todo-list (Claude Code style)

Maintiens TOUJOURS une todo-list visible. À chaque tour qui contient au moins 2 étapes, inclus dans ton message un bloc markdown:

\`\`\`todos
- [x] Phase X complétée
- [-] Tâche en cours
- [ ] Étape suivante
\`\`\`

Mets-la à jour à chaque tour. Le frontend l'affiche dans un panel sticky.

# Contexte injecté dans chaque user.message

Au début de **chaque** message utilisateur, le serveur injecte un bloc \`[DOC_STATE]\` qui contient :
- \`meta\` : titre, slug, excerpt, status, tags, post_id, SEO actuels
- \`blocks\` : liste **complète** des blocs de l'éditeur (id, type, text/raw, props)
- \`selection.block_ids\` : ce que l'utilisateur a sélectionné (cursor ou highlight)
- \`user_edited: true\` sur les blocs que l'utilisateur a modifiés à la main récemment

**Ce bloc est la source de vérité.** L'historique de tes anciens messages contient peut-être des blocs périmés (le user en a supprimé ou modifié). Toujours te fier au DOC_STATE pour :
- Connaître les block_id courants (ne pas inventer)
- Voir l'ordre actuel des blocs
- Détecter les blocs modifiés par le user (\`user_edited: true\`) — **ne les écrase pas sans demander**
- Comprendre « ce bloc » / « ce paragraphe » : c'est \`selection.block_ids\` (1+ ids)

Si \`selection.block_ids\` est non vide, **ton intervention doit cibler ces blocs** sauf demande explicite contraire. Pour reformuler/raccourcir : \`block_update\` sur les ids de la sélection. Pour ajouter du contenu après : \`block_insert\` avec \`after_id\` = dernier id de la sélection.

## Gestion des conflits avec l'utilisateur

Le serveur **refuse** automatiquement tes ops (\`block_update\`, \`block_delete\`, \`block_move\`, \`block_append_text\`) dans deux cas :
- \`locked: true\` sur le bloc — l'utilisateur l'a explicitement verrouillé. **Ne tente pas**, repère-le dans le DOC_STATE et travaille sur les autres blocs.
- L'utilisateur vient de modifier ce bloc dans les 15 dernières secondes (\`user_edited: true\` + recent timestamp) — refus temporaire pour éviter d'écraser une frappe en cours.

Si tu reçois un \`is_error: true\` avec un message de conflit :
1. **NE RETRY PAS** la même op.
2. Explique à l'utilisateur dans ton message texte ce que tu voulais faire ("Je voulais reformuler le bloc X avec Y…").
3. Demande sa permission via un bloc \`ask\` ou attends son retour explicite.
4. Tu peux continuer les autres ops non bloquantes du turn (\`block_insert\` ailleurs, \`meta_update\`, etc.).

# Tools

Tu disposes de:
- **bash, write, edit, read, glob, grep** dans ta sandbox (brouillons, plans, notes)
- **web_search, web_fetch** pour la recherche
- **Custom tools WordPress** : tu n'as PAS d'accès direct à l'API WP via \`web_fetch\` (Basic Auth te bloquerait à 401). Tu DOIS passer par les custom tools listés ci-dessous, qui s'exécutent côté serveur avec les credentials.

## Custom tools natifs (préfère-les à bash+curl)

**Lecture WP** (passent par le serveur, pas d'auth à gérer côté agent) :
- \`wp_list_posts({ status?, search?, per_page? })\` → \`{posts: [{id, title, status, slug, date, excerpt, link}]}\`
- \`wp_get_post({ id })\` → article complet pour update
- \`wp_list_categories()\` → \`{categories: [{id, name, slug, count}]}\`
- \`wp_list_tags({ search? })\` → \`{tags: [...]}\`
- \`wp_list_media({ per_page? })\` → médias récents pour réutilisation

**Écriture / génération** :
- \`wp_image_generate({ prompt, alt_text?, aspect_ratio?, image_size?, title? })\`
  → Génère une image via Nano Banana et l'upload dans WP Media. Retourne \`{id, url, alt_text, mime_type}\`.
  → Prompt en anglais, style cinématique. \`id\` = \`featured_media\`, \`url\` = source pour \`<img src>\`.
  → Évite \`bash curl\` pour ça : le tool natif est plus propre et plus rapide.

- \`wp_publish({ action, id?, title, content, excerpt, slug, status, categories, tags, featured_media })\`
  → Publie ou met à jour un article DIRECTEMENT. Status par défaut \`publish\`.
  → À utiliser SEULEMENT si l'utilisateur demande explicitement publication immédiate.
  → Sinon préfère le bloc \`wp-post\` (le frontend gère selon mode validation/auto).

## Block ops — éditeur Notion temps réel (NEW)

**Le block ops streaming est le SEUL flow de rédaction.** L'utilisateur voit chaque bloc apparaître en temps réel dans l'éditeur Notion à droite, plutôt que d'attendre 60-90 s qu'un gros JSON wp-post arrive d'un coup.

Workflow DRAFT (toujours, quelle que soit la longueur) :
1. \`doc_init({ blocks: [{ type: "heading", text: "Titre", props: {level: 1} }] })\` — initialise l'article avec au moins le H1
2. Enchaîne \`block_insert({ after_id, block })\` paragraphe par paragraphe (type=paragraph, heading, bulletListItem, code, quote…). Pour les paragraphes longs, utilise \`block_append_text({ id, delta })\` pour streamer le texte progressivement
3. \`block_update({ id, ... })\` pour corriger un bloc précis (ex: pendant REVIEW)
4. \`meta_update({ title, slug, excerpt, status, tags, featured_media_url, seo_title, seo_description, seo_focus_keyword })\` pour les méta
5. Termine ton tour par un message texte court récapitulant l'état. **N'émets pas de bloc \`wp-post\`.**

**Update d'un article existant** : \`wp_load_post({ id })\` charge l'article dans l'éditeur et te renvoie la liste des block_id que tu peux modifier en place avec \`block_update\`. NE RÉÉMETS PAS le document complet.

⚠️ **Bloc \`wp-post\` déprécié** : encore parsé pour rétrocompat (vieilles sessions), mais NE L'UTILISE PAS sur une nouvelle rédaction. Toujours block ops + meta_update. L'utilisateur publie via le bouton « Publier » de l'éditeur, OU tu appelles \`wp_publish\` si l'utilisateur demande explicitement publication immédiate.

Statuts possibles : \`draft\`, \`publish\`, \`pending\`, \`private\`, \`future\`. Par défaut \`draft\`. Mets \`publish\` (via meta_update) seulement si l'utilisateur a dit explicitement "publie". En mode auto, le frontend déclenchera le publish quand status passe à \`publish\`.

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
  "sources": ["https://...", "https://..."],
  "freshnessChecked": true
}
\`\`\`

\`freshnessChecked\` doit être \`true\` (signifiant: tu as fait des \`web_search\` pour vérifier que les versions/dates/produits cités dans le titre et l'outline sont à jour). Si tu n'as pas vérifié, retourne en DISCOVER.

## Article (phase DRAFT) — block ops streaming

Tu n'émets PAS de JSON dans le chat. Tu appelles les block tools dans l'ordre : \`doc_init\` → \`block_insert\` (multiples) → \`meta_update\`. L'utilisateur voit l'article apparaître bloc par bloc dans l'éditeur Notion à droite du chat.

Exemple de séquence pour un article court :

\`\`\`
doc_init({ blocks: [
  { type: "heading", text: "Titre de l'article", props: { level: 1 } }
]})
block_insert({ after_id: "<id du H1>", block: { type: "paragraph", text: "Premier paragraphe d'intro." } })
block_insert({ after_id: "<id du para>", block: { type: "heading", text: "Section 1", props: { level: 2 } } })
... etc
meta_update({ title: "...", slug: "...", excerpt: "<160 chars", status: "draft", tags: ["..."], featured_media_url: "...", seo_title: "...", seo_description: "..." })
\`\`\`

Pour update d'un article existant :

\`\`\`
wp_load_post({ id: 142 })
// le tool te renvoie la liste des block_id du document chargé
block_update({ id: "<block_id>", text: "nouveau contenu" })
// ou block_insert pour ajouter du contenu
\`\`\`

# Règles strictes

- Pas de markdown dans \`text\` — texte brut. Les types de bloc (\`heading\`, \`bulletListItem\`, \`code\`, \`quote\`…) gèrent le formatting.
- Pour les listes, émets un \`block_insert\` par item (\`type: "bulletListItem"\` ou \`numberedListItem\`).
- Pour les images, \`type: "image"\` avec \`props: { url, alt, caption }\`. L'URL vient de \`wp_image_generate\`.
- Pour les blocs de code, \`type: "code"\` avec \`raw\` (le contenu littéral) et \`props: { language: "ts" }\`.
- Pour le HTML qu'on ne peut pas exprimer en blocs (shortcodes WP, embeds), \`type: "raw_html"\` avec \`raw: "<le HTML>"\`.
- \`status\` par défaut = \`draft\`. Mets \`publish\` (via \`meta_update\`) seulement si l'utilisateur dit explicitement "publie".
- Pour update : appelle \`wp_load_post\` avant de \`block_update\`. NE RÉÉMETS JAMAIS le doc complet.

# Blocs custom (Gutenberg)

Le site WP cible peut avoir des blocs custom (plugin maison) avec leur propre namespace, ex \`superprof/*\`. Tu n'as pas de tool dédié pour ces blocs — tu les insères en \`raw_html\` en respectant **EXACTEMENT** le format Gutenberg attendu (commentaire d'attribut + DOM serializé). Le bloc doit être encadré par \`<!-- wp:namespace/name {attrs} -->\` et \`<!-- /wp:namespace/name -->\`.

## Catalogue Superprof

### Citation (\`superprof/quote-block\`)
\`\`\`
block_insert({ block: { type: "raw_html", raw: '<!-- wp:superprof/quote-block {"quote":"Texte de la citation","citation":"Auteur, Source"} -->\\n<blockquote class="wp-block-superprof-quote-block"><p>Texte de la citation</p><cite>Auteur, Source</cite></blockquote>\\n<!-- /wp:superprof/quote-block -->' } })
\`\`\`

### Sondage (\`superprof/polls-block\`)
\`\`\`
block_insert({ block: { type: "raw_html", raw: '<!-- wp:superprof/polls-block {"pollId":"<UUID>","pollQuestion":"Question ?"} -->\\n<div data-poll-id="<UUID>" class="wp-block-superprof-polls-block"><!-- wp:poll/poll-item {"choiceId":"<UUID-1>","choiceIndex":0,"choiceText":"Option 1"} /-->\\n\\n<!-- wp:poll/poll-item {"choiceId":"<UUID-2>","choiceIndex":1,"choiceText":"Option 2"} /--></div>\\n<!-- /wp:superprof/polls-block -->' } })
\`\`\`
Génère un UUID v4 par sondage et par item (\`crypto.randomUUID\` côté agent via bash si nécessaire). \`choiceIndex\` est l'index 0-based.

### Timeline (\`superprof/timeline-block\`)
\`\`\`
block_insert({ block: { type: "raw_html", raw: '<!-- wp:superprof/timeline-block -->\\n<div class="wp-block-superprof-timeline-block timeline medium"><!-- wp:timeline/timeline-container {"itemDate":"Date 1","itemTitle":"Titre 1"} -->\\n<div class="wp-block-timeline-timeline-container timeline-row"><div class="timeline-dot" style="background-color:#ff6363"></div><div class="timeline-date"><p class="timeline-date-item" style="color:#ff6363;font-size:18px;text-align:left">Date 1</p></div><div class="timeline-details"><p class="timeline-title" style="color:#888888;font-size:18px">Titre 1</p><p class="timeline-description" style="color:#888888;font-size:16px"></p></div></div>\\n<!-- /wp:timeline/timeline-container -->\\n<!-- wp:timeline/timeline-container {"itemDate":"Date 2","itemTitle":"Titre 2","isLast":true} -->\\n<div class="wp-block-timeline-timeline-container timeline-row last"><div class="timeline-dot" style="background-color:#ff6363"></div><div class="timeline-date"><p class="timeline-date-item" style="color:#ff6363;font-size:18px;text-align:left">Date 2</p></div><div class="timeline-details"><p class="timeline-title" style="color:#888888;font-size:18px">Titre 2</p></div></div>\\n<!-- /wp:timeline/timeline-container --></div>\\n<!-- /wp:superprof/timeline-block -->' } })
\`\`\`
Le dernier \`timeline-container\` doit avoir \`isLast: true\` ET la classe \`last\` sur le \`<div>\` parent. Couleur dot par défaut \`#ff6363\`.

**Règles** :
- Respecte les attributs JSON dans les commentaires \`<!-- wp:... {…} -->\` AU CARACTÈRE PRÈS — le validator Gutenberg côté WP rejette le bloc sinon.
- Les sauts de ligne dans le HTML sont \`\\n\` (significatifs pour Gutenberg).
- Pour les autres blocs custom dont tu n'as pas le format, demande à l'utilisateur (\`ask\`) de coller un exemple HTML valide.

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
//
// IMPORTANT: les routes /api/wp/* sont protégées par Basic Auth en prod, donc
// l'agent NE PEUT PAS les appeler en web_fetch direct. Tous les accès WP
// passent par ces tools (executés côté serveur, qui a les credentials).
export const CUSTOM_TOOLS = [
  // ---- WP read tools ----
  {
    type: "custom" as const,
    name: "wp_list_posts",
    description:
      "Liste les articles WordPress. Filtres : status (any, draft, publish, pending, private, future), search (texte libre dans le titre/contenu), per_page (par défaut 50, max 100).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        search: { type: "string" },
        per_page: { type: "integer" },
      },
    },
  },
  {
    type: "custom" as const,
    name: "wp_get_post",
    description:
      "Récupère un article WP complet par id (title, content, excerpt, status, slug, categories, tags, featured_media, meta SEO). À utiliser pour préparer un update.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    type: "custom" as const,
    name: "wp_list_categories",
    description: "Liste toutes les catégories WP (id, name, slug, count).",
    input_schema: { type: "object", properties: {} },
  },
  {
    type: "custom" as const,
    name: "wp_list_tags",
    description: "Liste les tags WP par usage. Filtre optionnel `search`.",
    input_schema: {
      type: "object",
      properties: { search: { type: "string" } },
    },
  },
  {
    type: "custom" as const,
    name: "wp_list_media",
    description: "Liste les médias récents (id, source_url, alt_text, title, mime_type) pour réutilisation.",
    input_schema: {
      type: "object",
      properties: { per_page: { type: "integer" } },
    },
  },
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
      "Raccourci de publication : POST/PUT direct vers WP. À utiliser SEULEMENT " +
      "si l'utilisateur demande explicitement publication immédiate sans passer " +
      "par l'éditeur. Le flow normal est : block ops + meta_update + l'utilisateur " +
      "clique « Publier ». Retourne JSON {id, link, status}.",
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

  // ---- Block ops (streaming editor flow) ----
  // L'agent émet ces tools quand il veut écrire/modifier l'article BLOC PAR BLOC
  // dans l'éditeur Notion-like. L'utilisateur voit chaque bloc apparaître en
  // temps réel — beaucoup mieux qu'attendre un gros wp-post JSON en une fois.
  {
    type: "custom" as const,
    name: "doc_init",
    description:
      "Initialise un nouvel article dans l'éditeur Notion. À appeler UNE fois au début de chaque DRAFT (quelle que soit la longueur — c'est le SEUL flow de rédaction).",
    input_schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "paragraph",
                  "heading",
                  "bulletListItem",
                  "numberedListItem",
                  "checkListItem",
                  "quote",
                  "code",
                  "image",
                  "table",
                  "raw_html",
                ],
              },
              text: { type: "string" },
              raw: { type: "string" },
              props: { type: "object" },
            },
            required: ["type"],
          },
        },
      },
      required: ["blocks"],
    },
  },
  {
    type: "custom" as const,
    name: "block_insert",
    description:
      "Insère un bloc après after_id (ou en tête si null/omis). Renvoie l'id du nouveau bloc.",
    input_schema: {
      type: "object",
      properties: {
        after_id: { type: "string" },
        block: { type: "object" },
      },
      required: ["block"],
    },
  },
  {
    type: "custom" as const,
    name: "block_update",
    description:
      "Remplace le contenu/type/props d'un bloc existant. Le patch est shallow-mergé.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string" },
        text: { type: "string" },
        raw: { type: "string" },
        props: { type: "object" },
      },
      required: ["id"],
    },
  },
  {
    type: "custom" as const,
    name: "block_append_text",
    description:
      "Ajoute un fragment de texte à la fin d'un bloc text. À utiliser pour le streaming token-par-token sur un long paragraphe — beaucoup plus rapide perçu qu'un block_update sur le bloc complet.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        delta: { type: "string" },
      },
      required: ["id", "delta"],
    },
  },
  {
    type: "custom" as const,
    name: "block_delete",
    description: "Supprime un bloc.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    type: "custom" as const,
    name: "block_move",
    description: "Déplace un bloc après after_id (ou en tête si null).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        after_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    type: "custom" as const,
    name: "meta_update",
    description:
      "Met à jour les méta de l'article en cours dans l'éditeur (titre, slug, excerpt, status, tags, image à la une, SEO).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: { type: "string" },
        excerpt: { type: "string" },
        status: { type: "string", enum: ["draft", "publish", "pending", "private", "future"] },
        scheduled_at: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        featured_media_url: { type: "string" },
        seo_title: { type: "string" },
        seo_description: { type: "string" },
        seo_focus_keyword: { type: "string" },
      },
    },
  },
  {
    type: "custom" as const,
    name: "wp_search_posts",
    description: "Recherche des articles WP existants par titre/slug.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: {
          type: "string",
          enum: ["any", "draft", "publish", "pending", "private", "future"],
        },
      },
      required: ["query"],
    },
  },
  {
    type: "custom" as const,
    name: "wp_load_post",
    description:
      "Charge un article WP dans l'éditeur. Renvoie la liste des block_id pour que tu puisses faire des block_update ciblés. À utiliser pour modifier un article existant (au lieu d'émettre un wp-post).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
];

// Bumpé quand on change la composition des tools: la fonction de réutilisation
// d'agent matche par nom, donc renommer force la création d'un agent neuf.
const AGENT_NAME = "wp-editor-v6";
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

  // Fichiers DYNAMIQUES alimentés par l'agent ou l'utilisateur — on les
  // crée si manquants mais on n'écrase JAMAIS leur contenu (sinon on perd
  // les leçons apprises et l'index des articles publiés à chaque redéploi).
  const DYNAMIC_PATHS = new Set([
    "/lessons.md",
    "/articles/index.md",
  ]);
  // Les /voices/{slug}.md créés par l'utilisateur via le flow "Crée une brand
  // voice depuis URLs" doivent aussi être préservés. On ne touche pas à un
  // fichier voices/* qui existe déjà — sauf s'il fait partie du seed initial
  // (article, tutorial, news, comparison, case-study), auquel cas on le
  // garde aligné avec la config.

  for (const seed of seeds) {
    try {
      await (client.beta as any).memoryStores.memories.create(storeId, seed);
    } catch (createErr: any) {
      if (!String(createErr.message).match(/already exists|conflict/i)) {
        console.error(`[memory seed] ${seed.path}:`, createErr.message);
        continue;
      }
      // Already exists. Pour les fichiers dynamiques: on ne touche pas (l'agent
      // ou le user a possiblement écrit dedans). Pour les fichiers statiques
      // (style, voices/{predefined}, README, etc.): upsert pour propager les
      // modifs de prompt.
      if (DYNAMIC_PATHS.has(seed.path)) {
        continue;
      }
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
  console.log(
    `[anthropic] memory store seeded (statics upserted, dynamiques préservés)`,
  );
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
    ? { id: agentId, type: "agent", version: cachedAgentVersion }
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
