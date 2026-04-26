# Article Code · WP Editor

Agent IA éditorial pour WordPress, conçu comme un Claude Code mais pour des articles. Workflow par phases (DISCOVER → PLAN → DRAFT → REVIEW → PUBLISH), brand voices par type de page, génération d'images via Nano Banana, mémoire persistante entre sessions.

**Live** : https://agent.76.13.59.178.nip.io

## Stack

- **server/** — Node + Express + `@anthropic-ai/sdk` (v0.91+). Crée l'agent Managed, expose un proxy SSE avec backfill, dispatcher de custom tools, endpoints WP REST + génération d'image, rate limit + cost tracker.
- **web/** — Vite + React + Tailwind + react-markdown. UI click-only, parser de blocs (`wp-plan`, `wp-post`, `ask`, `todos`), DraftCard avec état pending/published/error, session persistante en localStorage.
- **deploy/** — `docker-compose.local.yml` (build local) + `install.sh` (bootstrap VPS) + Traefik labels pour Hostinger.
- **.github/workflows/deploy.yml** — CI auto-deploy SSH vers la VPS à chaque push.

### Arborescence frontend

```
web/src/
├── App.tsx              — orchestrateur (~300 lignes, state + side effects + layout)
├── main.tsx             — bootstrap React
├── useSession.ts        — hook session + SSE + typewriter + reconnect
├── api.ts               — fetch wrappers (createSession, sendMessage, publishDraft…)
├── parseDraft.ts        — extracteurs des blocs (wp-plan, wp-post, ask, todos)
├── types.ts             — ChatMessage, MessageBlock, WpDraft, PublishState…
├── PublishModal.tsx     — modal de publication (mode validation)
├── index.css            — Tailwind + styles markdown-body
├── lib/
│   └── toolLabels.ts    — friendlyLabel + prettyPath + helpers
└── components/
    ├── Header.tsx       — header + StatusDot + ModeToggle + bouton nouvelle session
    ├── EmptyState.tsx   — démarreurs cliquables (idées, brand voice, préférences…)
    ├── TodosBar.tsx     — barre collapsible avec phase + progress + checklist
    ├── Thinking.tsx     — indicateur "l'agent travaille…" + activité streaming + silence age
    ├── MessageBubble.tsx— bulle assistant: itère sur message.blocks (tool/text)
    ├── ToolCallRow.tsx  — pill cliquable avec icon/verb/detail + JSON expand
    ├── AskCard.tsx      — boutons cliquables, collapse en récap après réponse
    ├── PlanCard.tsx     — brief avec outline/tags/sources + bouton Approuver
    ├── DraftCard.tsx    — wp-post avec état pending/published/error + lien external
    ├── ChatInput.tsx    — footer collapsible (mode boutons / mode texte)
    └── Toast.tsx        — notif bottom-right cliquable
```

### Arborescence backend

```
server/src/
├── index.ts             — bootstrap Express
├── env.ts               — chargement dotenv
├── app.ts               — routes + SSE pump + custom tool dispatcher + rate limits + cost tracker
├── anthropic.ts         — client SDK + system prompt + agent/env/memory store getOrCreate + custom tools schemas
├── wordpress.ts         — WP REST API (list/get/create/update posts, categories, tags, media, dedup slug 60s)
└── nanobanana.ts        — Gemini Flash Image API + slugifyForFilename
```

---

## Architecture

```
Browser (mobile/desktop)
  │   sessionId persisté en localStorage
  ▼
agent.${VPS_IP}.nip.io   ← Traefik Hostinger (TLS Let's Encrypt)
  ├── /         → web (Vite build, nginx)
  └── /api/*    → server (Express, port 3001)
                   ├── Anthropic Managed Agents API
                   │     ├── client.beta.agents (idempotent: list-or-create)
                   │     ├── client.beta.environments (cloud + networking unrestricted)
                   │     ├── client.beta.sessions (agent pinned via {id, type, version})
                   │     ├── client.beta.sessions.events (list backfill + stream live)
                   │     └── client.beta.memoryStores (workspace-scoped, dynamic preserved)
                   ├── WP REST API (/wp-json/wp/v2)
                   │     └── auth Basic via WP Application Password (server-side)
                   └── Gemini Nano Banana (gemini-3.1-flash-image-preview)
                         └── upload résultat dans WP Media
```

---

## Prérequis

- Node 20+
- VPS Hostinger Ubuntu 24.04 + Docker + Traefik (template officiel) — OU local + tunnel
- Clé API Anthropic (`sk-ant-...`) avec accès Managed Agents (header beta `managed-agents-2026-04-01`, auto-injecté par le SDK)
- Clé API Gemini pour Nano Banana
- WordPress self-hosted accessible publiquement + Application Password WP

### Générer un Application Password WP

1. wp-admin → Users → Profile → **Application Passwords**
2. Donne un nom (`managed-agent`) → **Add New Application Password**
3. Copie le token affiché — il ne sera plus visible. Format `xxxx xxxx xxxx xxxx xxxx xxxx`.

### Récupérer une clé Gemini

https://aistudio.google.com/app/apikey

---

## Setup local (dev)

```bash
# Backend
cd server
cp .env.example .env
# Édite .env (voir variables ci-dessous)
npm install
npm run dev   # http://localhost:3001

# Frontend (autre terminal)
cd web
npm install
npm run dev   # http://localhost:5180 (proxy /api → localhost:3001)
```

### Variables d'environnement (server/.env)

| Var | Obligatoire | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Clé API Anthropic avec accès Managed Agents |
| `WP_BASE_URL` | ✅ | URL du WordPress sans trailing slash |
| `WP_USER` | ✅ | Username admin WP |
| `WP_APP_PASSWORD` | ✅ | Application Password WP |
| `GEMINI_API_KEY` | ⚠️ optionnel | Active la génération d'images Nano Banana |
| `PUBLIC_BASE_URL` | ⚠️ optionnel | URL publique de l'app, injectée dans le system prompt de l'agent (pour `web_fetch` sur nos endpoints) |
| `PORT` | optionnel (3001) | Port du serveur Express |
| `AGENT_MODEL` | optionnel | Override du modèle (`claude-sonnet-4-6` par défaut, `claude-opus-4-6` ou `claude-opus-4-7` possibles) |
| `AGENT_SPEED` | optionnel | `standard` (défaut) ou `fast` (premium pricing, supporté par Opus 4.6) |
| `GEMINI_IMAGE_MODEL` | optionnel | Modèle Gemini, défaut `gemini-3.1-flash-image-preview` |
| `MEMORY_STORE_ID` | optionnel | Pour skip la résolution si on connaît déjà l'ID |

---

## Déploiement VPS Hostinger

Le `docker-compose.local.yml` est prévu pour cohabiter avec le Traefik de l'image Hostinger "Ubuntu 24.04 with Docker and Traefik".

### Bootstrap (une fois)

Dans le Browser Terminal Hostinger (ou en SSH) :

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
export WP_BASE_URL='https://wp.example.com'
export WP_USER='admin'
export WP_APP_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx'
export GEMINI_API_KEY='AIza...'
export VPS_IP='76.13.59.178'
curl -fsSL https://raw.githubusercontent.com/Nicogugu/managed-agents/claude/bootstrap-project-BsFvC/deploy/install.sh | sudo -E bash
```

L'app est sur `https://agent.${VPS_IP}.nip.io` après ~2-3 min (Let's Encrypt + build).

### CI/CD auto-deploy

`.github/workflows/deploy.yml` SSH dans la VPS à chaque push sur `main` ou la branche bootstrap, fait `git pull` + `docker compose up -d --build`, puis smoke-test `/api/health`.

**Secrets GitHub requis** :
- `SSH_PRIVATE_KEY` — clé privée ed25519 (la publique est sur la VPS via Hostinger API `public-keys/attach`)
- `VPS_HOST` — IP
- `VPS_USER` — `root`
- `ANTHROPIC_API_KEY`, `WP_BASE_URL`, `WP_USER_LOGIN`, `WP_APP_PASSWORD`, `GEMINI_API_KEY`, `VPS_IP` — réinjectés dans `.env` à chaque deploy (le `.env` sur la VPS est ainsi reproductible)

---

## Workflow agent (5 phases)

L'agent est un **Article Code** : il décompose chaque tâche en 5 phases explicites, tient une todo-list dans ses messages, et confirme la fin de chaque tour.

| Phase | Quoi | Tool calls typiques |
|---|---|---|
| **DISCOVER** | Comprendre la demande, scanner l'existant, vérifier la fraîcheur du sujet | `web_fetch /api/wp/posts?search=`, 1-2 `web_search` avec année courante (la date du jour est injectée dans le system prompt) |
| **PLAN** | Émet un bloc `wp-plan` JSON et **STOP** en attendant validation | (aucun) |
| **DRAFT** | Lit la brand voice du type de page, génère l'image cover, rédige | 1 `read /mnt/memory/.../voices/{type}.md`, 1 `wp_image_generate`, possiblement `write /tmp/article.html` puis `edit` pour itérer |
| **REVIEW** | Auto-vérification (H1, excerpt, alt text, slug, liens internes) | (aucun) |
| **PUBLISH** | Émet le bloc `wp-post` final | (aucun — le frontend gère selon mode) |

### Modes de publication

- **Validation** (toggle Header) : le frontend affiche une carte avec bouton **Publier**, le user clique pour confirmer.
- **Auto-publish** (par défaut) : le frontend POST direct dès que le bloc `wp-post` est extrait. Status forcé à `publish`.

Le mode est persisté en localStorage.

---

## Tools disponibles à l'agent

### Built-in (`agent_toolset_20260401`)

`bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_search`, `web_fetch`.

### Custom tools (notre serveur)

| Tool | Effet |
|---|---|
| `wp_image_generate({prompt, alt_text?, aspect_ratio?, image_size?, title?})` | Génère via Gemini Nano Banana → upload dans WP Media → renvoie `{id, url, alt_text, mime_type}` |
| `wp_publish({action, id?, title, content, excerpt, slug, status, categories, tags, featured_media})` | Publie ou update un post WP directement (à éviter en parallèle d'un bloc `wp-post`, créerait un doublon) |

Le dispatcher serveur (`app.ts:dispatchCustomTool`) écoute `agent.custom_tool_use` dans le pump SSE et renvoie `user.custom_tool_result` après exécution. Garde un anti-double-dispatch via `seenAnthropicIds` qui persiste entre redémarrages du pump.

### Endpoints serveur (l'agent y accède via `web_fetch`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | Healthcheck (clés présentes) |
| POST | `/api/sessions` | Crée une session Managed Agent |
| GET  | `/api/sessions/:id` | Vérifie l'existence d'une session (pour resume localStorage) |
| GET  | `/api/sessions/:id/stream` | SSE avec backfill via `events.list` + tail live via `events.stream`. Supporte `Last-Event-ID` (header) ou `?last_event_id=N` (query, fallback mobile) |
| POST | `/api/sessions/:id/message` | Envoie un `user.message` |
| POST | `/api/sessions/:id/interrupt` | Envoie `user.interrupt` |
| GET  | `/api/wp/posts` | Liste articles. Filtres: `?status=`, `?search=`, `?per_page=` |
| GET  | `/api/wp/posts/:id` | Article complet pour update |
| GET  | `/api/wp/categories` | Liste catégories WP |
| GET  | `/api/wp/tags?search=` | Liste/cherche tags WP |
| GET  | `/api/wp/media` | Liste médias récents |
| POST | `/api/wp/posts` | Crée un article WP (auto-publish ou modal) |
| PUT  | `/api/wp/posts/:id` | Update un article WP |
| POST | `/api/image` | Wrapper REST autour de `wp_image_generate` (utilisable hors agent) |

---

## Mémoire persistante

Memory store Anthropic `wp-editor-knowledge`, attaché à chaque session via `resources: [{type:"memory_store", memory_store_id, access:"read_write"}]`. Monté sur `/mnt/memory/wp-editor-knowledge/` dans la sandbox de l'agent.

### Arborescence

| Fichier | Type | Géré par |
|---|---|---|
| `README.md` | static | seed (upserts à chaque deploy) |
| `site.md` | static | seed |
| `audience.md` | static | seed |
| `style/voice.md` `style/banned.md` `style/preferred.md` | static | seed |
| `image-style.md` | static | seed |
| `voices/{article,tutorial,news,comparison,case-study}.md` | static (5 brand voices prédéfinies) | seed |
| `voices/{slug}.md` créés via "brand voice depuis URL" | dynamic | agent (préservé) |
| `articles/index.md` | **dynamic** | agent (préservé) |
| `lessons.md` | **dynamic** | agent (préservé) |

⚠️ Les fichiers `dynamic` sont créés par le seed s'ils n'existent pas, mais **JAMAIS écrasés** ensuite (cf. `DYNAMIC_PATHS` dans `seedMemoryStore`). Sinon les écritures de l'agent disparaîtraient à chaque deploy.

### Récupérer une version perdue

Anthropic garde **30 jours** d'audit trail (`memory_versions`). Pour restaurer :

```ts
const versions = await client.beta.memoryStores.memoryVersions.list(STORE_ID);
// trouve la version souhaitée
const v = await client.beta.memoryStores.memoryVersions.retrieve(versionId, { memory_store_id });
// écris son content sur la version courante
await client.beta.memoryStores.memories.update(memoryId, { memory_store_id, content: v.content });
```

---

## SSE robuste (resume après veille)

Sur mobile, le browser tue l'EventSource après 3-5 min en arrière-plan. On gère :

1. **Server-side buffer** in-memory par session avec sequence id local. Heartbeat `: ping` toutes les 15s pour empêcher Traefik de couper la connexion idle.
2. **Backfill** : à chaque démarrage du pump, on appelle `events.list({order:'asc'})` pour rejouer toute l'histoire (le stream Anthropic ne renvoie que les events live, pas le passé).
3. **Pump redémarrable** : `state.pumpStarted` repasse à `false` quand le stream Anthropic se ferme. La prochaine connexion SSE relance le pump (avec `seenAnthropicIds` qui persiste pour dédupliquer).
4. **Last-Event-ID** : le client envoie soit le header SSE standard, soit `?last_event_id=N` en query (fallback quand le browser recrée manuellement l'EventSource sur `visibilitychange`/`focus`/`pageshow`).
5. **Replay vs live** : les events qui sortent du buffer sont marqués `_replayed: true`. Le client les insère sans typewriter (sinon rejouer 50 events serait douloureusement lent).

### Session persistante

Le `sessionId` est stocké dans `localStorage["wp-editor.sessionId"]`. Au démarrage, on tente de réutiliser via `sessionExists()` (GET `/api/sessions/:id`). Si KO, on en crée une nouvelle. Bouton **+ nouvelle session** dans le header pour forcer une session fresh.

---

## UI : protocoles spéciaux

L'agent émet des blocs en triple backtick avec un langage custom. Le frontend les parse et rend des cartes spécialisées au lieu du texte brut.

### `ask` — choix click-only

```ask
{
  "question": "Quel angle veux-tu ?",
  "options": [
    { "emoji": "🎯", "label": "Tutoriel", "description": "Step-by-step", "value": "Vasy avec un tutoriel" },
    { "emoji": "📊", "label": "Comparatif", "description": "3 solutions", "value": "Vasy avec un comparatif" }
  ]
}
```

Le frontend rend des boutons cliquables. Click → `appendUserMessage(label)` + `sendMessage(value)`. Une fois cliqué, la carte se collapse en une ligne récap avec le choix.

### `wp-plan` — brief avant DRAFT

```wp-plan
{
  "title": "...", "slug": "...", "outline": ["H2 Intro", "..."],
  "category": "Tech", "tags": ["..."],
  "image": { "needed": true, "prompt": "..." },
  "wordCount": 800, "internalLinks": [{"id": 22, "anchor": "..."}],
  "sources": ["https://..."], "freshnessChecked": true
}
```

Carte avec outline, tags, sources, prompt image, bouton **✓ Approuver et drafter** qui envoie "vasy".

### `wp-post` — article final

```wp-post
{
  "action": "create" | "update",
  "id": 123,                       // requis pour update
  "title": "...", "content": "<p>...</p>",
  "excerpt": "...", "slug": "...",
  "status": "draft" | "publish" | "pending" | "private",
  "categories": [12], "tags": ["nom"],   // strings → IDs (créés si absents)
  "featured_media": 42                    // id renvoyé par wp_image_generate
}
```

Rendue comme `DraftCard` avec 3 états : `pending` (📤 publication…), `published` (✓ publié #N + lien `target=_blank`), `error` (⚠ erreur + bouton Réessayer).

### `todos` — checklist visible

```todos
- [x] Phase X complétée
- [-] Tâche en cours
- [ ] Étape suivante
```

Affichée dans la `TodosBar` collapsible en haut, avec phase courante (DISCOVER/PLAN/DRAFT/REVIEW/PUBLISH) et progression `N/M`.

---

## Protections / dedup

### Anti-doublon WP côté serveur

`createPost()` cache les `slug` créés dans les 60 dernières secondes. Si le même slug arrive 2× dans cette fenêtre, on retourne le post déjà créé au lieu d'en créer un nouveau. Évite les doublons quand l'agent fait à la fois un bloc `wp-post` (consommé par le frontend) ET un appel `wp_publish` (via custom tool).

### Idempotence Anthropic

- `getOrCreateAgent()` : list-or-create par `name + model + system + speed`. Si le system prompt change, un nouvel agent est créé (ancien orphelin mais accessible par ID).
- `getOrCreateEnvironment()` : cache en mémoire process.
- `getOrCreateMemoryStore()` : list-or-create par nom. Seed une fois par process via `memorySeededThisProcess`.
- `session.create` pin la version d'agent : `agent: { id, type:"agent", version }` pour qu'une session ne drift pas si l'agent est updaté.

---

## Sécurité & limites de coût

- **Auth Basic Express** : `/api/*` (sauf `/api/health` laissé public pour les health checks externes) est gated par un middleware Basic Auth. Configurable via env `AUTH_USER` + `AUTH_PASS` (plain text, pas de hash bcrypt à générer). Les credentials sont stockés en secrets GitHub (`AUTH_USER`, `AUTH_PASS`) et transitent en base64 jusqu'à la VPS pour éviter les corruptions shell. Le browser ouvre une popup de login au premier accès.
  - On a essayé d'utiliser le middleware Basic Auth de Traefik mais il causait un panic Go sur la config — switch sur Express middleware plus simple et plus robuste. La frontend (`web/`) reste publique car elle ne contient aucun secret (juste le bundle JS).
- **Rate limits par IP** (express-rate-limit) :
  - 20 sessions/h max (créations Anthropic = $$)
  - 30 messages/min max (par session)
  - 10 écritures WP/min max (publish + image gen)
- **Cap de coût journalier** (optionnel) via `DAILY_COST_USD_CAP` env var. L'app refuse les nouvelles sessions et messages si dépassé. Lecture (GET) reste autorisée.
- **GET `/api/admin/stats`** : agrégat journalier (tokens input/output, cache, images, coût estimé en USD). Optionnellement protégé par header `X-Admin-Token` si `ADMIN_TOKEN` est set.
- `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `WP_USER`, `WP_APP_PASSWORD` ne quittent **jamais** le serveur.
- L'agent ne reçoit **jamais** les credentials WP : c'est le backend qui authentifie auprès de WP via Application Password en Basic Auth.
- En mode auto-publish, l'agent peut faire publier sans validation utilisateur — utiliser avec discernement.
- Le memory store est attaché en `read_write`. Une injection de prompt via input externe (`web_fetch` sur un site malveillant, etc.) pourrait modifier la mémoire. À considérer si les sources web deviennent moins triées.
- Le bot Anthropic Managed Agents tourne dans un container isolé chez Anthropic — pas d'accès direct à ton VPS ou à ta DB.

---

## Limites / TODO

- **Token streaming** : l'API Managed Agents v2 ne stream pas les tokens (`agent.message` arrive d'un bloc). On simule un typewriter ~1500 chars/sec côté client. [Issue Anthropic](https://github.com/anthropics/claude-code/issues/41732).
- **Multi-agent / outcomes** : research preview, non disponibles dans le SDK 0.91. À considérer pour spawn un sub-agent "Researcher" en parallèle ou valider que le wp-post final est parseable.
- **Skills custom** : prévu mais on a préféré le memory store pour les brand voices (plus simple, dynamique, idempotent sans upload zip).
- **Files API** (input PDF/image vers l'agent) : pas implémenté.
- **Memory versions UI** : on peut restaurer manuellement via SDK, pas d'UI dédiée.
- **Multi-site** : un seul `WP_BASE_URL` actuel. Pour multi-site, créer un memory store par site et templater la session.

---

## Commandes utiles

```bash
# Tests
cd server && npm test
cd web && npm test -- --run

# Type-check
cd server && npx tsc --noEmit
cd web && npx tsc --noEmit

# Build images Docker (sans push)
cd deploy && docker compose -f docker-compose.local.yml build

# Smoke test contre la prod
bash scripts/smoke.sh https://agent.76.13.59.178.nip.io
```

---

## Liens

- [Doc Anthropic Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)
- [Memory tool](https://platform.claude.com/docs/en/managed-agents/memory)
- [Custom tools / agent skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Gemini Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation)
- [WP REST API](https://developer.wordpress.org/rest-api/)
