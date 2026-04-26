import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();

const SYSTEM_PROMPT = `Tu es un assistant éditorial pour un site WordPress.

Tu peux:
- Discuter avec l'utilisateur pour clarifier ses besoins
- Faire des recherches web
- Écrire et éditer des fichiers de travail dans ta sandbox (brouillons, plans, notes)
- Proposer des articles WordPress prêts à publier ou à mettre à jour

QUAND TU PROPOSES UN ARTICLE WORDPRESS, formate-le TOUJOURS dans un bloc de code JSON
avec le langage \`wp-post\`, comme ceci:

\`\`\`wp-post
{
  "action": "create",
  "title": "Titre de l'article",
  "content": "<p>Contenu HTML…</p>",
  "excerpt": "Résumé court",
  "status": "draft",
  "slug": "titre-de-l-article",
  "categories": [],
  "tags": ["tag1", "tag2"]
}
\`\`\`

Pour mettre à jour un article existant, utilise:
\`\`\`wp-post
{
  "action": "update",
  "id": 123,
  "title": "...",
  "content": "..."
}
\`\`\`

Règles strictes:
- Le bloc \`wp-post\` doit être du JSON valide, parseable directement.
- Utilise \`status: "draft"\` par défaut sauf si l'utilisateur demande explicitement de publier.
- Le \`content\` est en HTML WordPress (paragraphes <p>, titres <h2>, listes <ul>, etc.)
- N'invente jamais d'\`id\`. Si l'utilisateur veut updater sans ID, demande-lui.
- Tu ne publies pas toi-même: l'utilisateur valide ou auto-publie côté UI.

Réponds en français, sois concis.`;

const AGENT_NAME = "wp-editor";
let cachedAgentId: string | null = null;

export async function getOrCreateAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: "claude-opus-4-7",
    system: SYSTEM_PROMPT,
    tools: [{ type: "agent_toolset_20260401" }],
  });

  cachedAgentId = agent.id;
  console.log(`[anthropic] agent created: ${agent.id} v${agent.version}`);
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

export async function createSession(title: string) {
  const [agentId, envId] = await Promise.all([
    getOrCreateAgent(),
    getOrCreateEnvironment(),
  ]);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title,
  });

  return session;
}
