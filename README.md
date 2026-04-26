# Managed Agents · WP Editor

Chat avec un agent Claude qui drafte des articles WordPress en JSON, avec deux modes : validation humaine (preview + bouton) ou auto-publish.

## Stack

- **server/** — Node + Express + `@anthropic-ai/sdk`. Crée l'agent Managed, proxy SSE, expose la WP REST API.
- **web/** — Vite + React + Tailwind. Chat UI, parsing des blocs `wp-post`, modal de publication.

## Prérequis

- Node 20+
- `pnpm` ou `npm`
- Une clé API Anthropic (`sk-ant-...`)
- Un WordPress self-hosted accessible publiquement
- Un **Application Password** WordPress

### Générer un Application Password WP

1. Connecte-toi à `wp-admin` en admin
2. Users → Profile → scroll jusqu'à **Application Passwords**
3. Donne un nom (ex : `managed-agent`) → **Add New Application Password**
4. Copie le token (format `xxxx xxxx xxxx xxxx xxxx xxxx`) — il ne sera plus affiché

> Si la section n'apparaît pas : Application Passwords requiert HTTPS et est activé par défaut depuis WP 5.6. Certains plugins de sécurité (iThemes, Wordfence) le désactivent — vérifie leurs paramètres.

## Setup

```bash
# 1. Backend
cd server
cp .env.example .env
# édite .env : ANTHROPIC_API_KEY, WP_BASE_URL, WP_USER, WP_APP_PASSWORD
npm install
npm run dev    # http://localhost:3001

# 2. Frontend (dans un autre terminal)
cd web
npm install
npm run dev    # http://localhost:5173
```

Le proxy Vite redirige `/api/*` vers `localhost:3001`.

## Comment ça marche

1. Au chargement, le front crée une **session** côté serveur. Le serveur instancie (au premier appel) un **agent** Claude Managed et un **environnement** sandbox, et démarre un stream SSE.
2. Tu écris un message → POST `/api/sessions/:id/message` → Anthropic le pousse dans la session.
3. L'agent répond en streaming : du texte (`agent.message`), des appels d'outils (`agent.tool_use`), etc.
4. Quand l'agent propose un article, il l'enveloppe dans un bloc :

   ````
   ```wp-post
   { "action": "create", "title": "...", "content": "<p>...</p>", "status": "draft" }
   ```
   ````

5. Le front parse ces blocs et affiche une carte « brouillon ».
   - **Mode Validation** : bouton **Prévisualiser & publier** → modal éditable → POST/PUT à `/api/wp/posts[/:id]`
   - **Mode Auto-publish** : le front pousse direct vers le serveur, le serveur crée/update sur WP

## Format `wp-post`

```json
{
  "action": "create" | "update",
  "id": 123,                       // requis pour update
  "title": "string",
  "content": "<html>...</html>",
  "excerpt": "string",
  "status": "draft" | "publish" | "pending" | "private",
  "slug": "string",
  "categories": [12, 34],          // IDs WP
  "tags": ["nom", "ou-id"]         // strings résolus en IDs (créés si absents)
}
```

## Capacités de l'agent

L'agent dispose du toolset complet `agent_toolset_20260401` :
- **bash** : commandes shell dans la sandbox
- **file ops** : read/write/edit/glob/grep dans la sandbox
- **web search & fetch** : recherche d'infos en ligne

Utile pour : recherche de sources, structuration en plusieurs fichiers (plan.md, brouillons), itérations multi-articles.

## Endpoints serveur

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/sessions` | Crée une session Managed Agent |
| POST | `/api/sessions/:id/message` | Envoie un user message |
| POST | `/api/sessions/:id/interrupt` | Interrompt l'agent |
| GET  | `/api/sessions/:id/stream` | SSE proxy depuis Anthropic |
| POST | `/api/wp/posts` | Crée un article WP |
| PUT  | `/api/wp/posts/:id` | Met à jour un article WP |

## Sécurité

- `ANTHROPIC_API_KEY`, `WP_USER`, `WP_APP_PASSWORD` ne quittent **jamais** le serveur
- L'agent ne reçoit **jamais** les credentials WP : c'est le backend qui appelle WP en mode A et B
- En mode Auto-publish, l'agent peut faire publier sans validation — utilise avec discernement

## TODO / améliorations possibles

- [ ] Persister les sessions (DB) pour reprendre une conversation
- [ ] Lister les articles WP existants depuis l'UI (pour update)
- [ ] Featured image (upload media → set featured_media)
- [ ] Multi-site (plusieurs WP_BASE_URL)
- [ ] MCP server custom pour exposer les actions WP comme tools natifs de l'agent
