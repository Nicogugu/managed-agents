import Anthropic from "@anthropic-ai/sdk";
import { client, getOrCreateEnvironment } from "./anthropic.js";

/**
 * Pre-publish review pipeline. Three specialised agents (legal compliance,
 * fact-checker, internal-linking) each get a fresh session per review with
 * the article draft injected, run their analysis in parallel, and emit a
 * single structured finding payload via the `submit_review_findings`
 * custom tool.
 *
 * This uses the public Managed Agents API (parallel sessions). The
 * native multi-agent feature (callable_agents + threads) is a research
 * preview we may not have access to yet.
 */

export type Severity = "info" | "warn" | "error";

export interface ReviewFinding {
  severity: Severity;
  message: string;
  /** If the finding targets a specific block in the editor. */
  block_id?: string;
  /** Optional concrete fix the user/agent could apply. */
  suggestion?: string;
  /** For internal-linking findings: which existing WP post to link to. */
  suggested_link?: {
    post_id: number;
    anchor_text: string;
    target_block_id?: string;
  };
}

export type ReviewKind = "legal" | "fact" | "links";

export const REVIEWER_LABELS: Record<ReviewKind, string> = {
  legal: "Légal & compliance",
  fact: "Fact-checking",
  links: "Liens internes",
};

const SUBMIT_TOOL = {
  type: "custom" as const,
  name: "submit_review_findings",
  description:
    "Émets le rapport de revue. **Appelle ce tool UNE SEULE FOIS** à la fin de ton analyse, puis stoppe. Si rien à signaler, passe `findings: []`. Sois concis : un finding par problème distinct, pas par phrase.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["info", "warn", "error"] },
            message: { type: "string" },
            block_id: { type: "string" },
            suggestion: { type: "string" },
            suggested_link: {
              type: "object",
              properties: {
                post_id: { type: "integer" },
                anchor_text: { type: "string" },
                target_block_id: { type: "string" },
              },
              required: ["post_id", "anchor_text"],
            },
          },
          required: ["severity", "message"],
        },
      },
    },
    required: ["findings"],
  },
};

const REVIEWER_PROMPTS: Record<ReviewKind, string> = {
  legal: `Tu es un reviewer **conformité juridique** pour un site WordPress éditorial.
Analyse l'article fourni et signale uniquement les **vrais risques juridiques**, pas du verbiage défensif.

Contrôle :
- **RGPD/CCPA** : mention de données personnelles sans base légale (cookies, tracking, formulaires)
- **Copyright** : citations longues sans source, images potentiellement protégées (vérifie via web_search si doute)
- **Claims réglementés** : santé/médical (« guérit », « soigne »), finance (« rendement garanti »), nutrition non sourcée
- **Diffamation** : accusations contre une personne/entreprise nommée sans source
- **Affirmations sensibles** : politique, religion, race, orientation — flag si propos manifestement biaisés

Ignore : style, fautes, SEO. Tu te concentres SUR LE RISQUE LÉGAL.

Sévérité :
- \`error\` : passe pas un audit, à corriger avant publication
- \`warn\` : zone grise, faudrait une source ou disclaimer
- \`info\` : bonne pratique optionnelle

Réponds SEULEMENT par un appel à \`submit_review_findings({findings: [...]})\` puis stop. Pas de blabla, pas de markdown.`,

  fact: `Tu es un reviewer **fact-checking** pour un site éditorial.
Vérifie les faits de l'article fourni en utilisant \`web_search\` (avec l'année courante dans tes requêtes) et \`web_fetch\` quand nécessaire.

Contrôle :
- **Dates et versions** : « v3.2 sortie en 2024 » → vérifier
- **Chiffres** : statistiques, prix, taille de marché, parts d'utilisateurs
- **Citations** : vérifier que la phrase attribuée à X a vraiment été dite
- **Noms propres** : entreprises, personnes, produits — orthographe + existence
- **Affirmations techniques** : claims sur capacités/limites d'un outil

Ignore : opinions personnelles non factuelles, hyperbole stylistique évidente.

Sévérité :
- \`error\` : fait clairement faux ou inventé
- \`warn\` : non vérifiable rapidement, douteux
- \`info\` : à actualiser (ex : version probablement obsolète)

Pour chaque finding, le \`message\` cite la phrase exacte concernée et la correction trouvée.

Réponds SEULEMENT par un appel à \`submit_review_findings({findings: [...]})\` puis stop.`,

  links: `Tu es un reviewer **liens internes** pour un site WordPress.

Ta mission : suggérer des liens internes vers des articles WP existants pour enrichir le maillage SEO. Tu disposes du tool \`wp_list_posts\` pour explorer le catalogue (utilise-le 1-2 fois max avec des \`search\` ciblés sur des mots-clés du draft).

Contrôle :
- Identifier 3-8 phrases du draft qui mentionnent un sujet déjà couvert dans un article WP existant
- Pour chaque, suggérer le \`post_id\` de l'article cible et un \`anchor_text\` court (2-5 mots) extrait du draft
- Ne suggère PAS de liens externes
- Ne suggère pas de liens vers le post_id du draft lui-même
- Si aucun match pertinent : \`findings: []\`

Sévérité : toujours \`info\` (suggestions, pas obligations).

Format : chaque finding contient \`block_id\` du bloc concerné + \`suggested_link: { post_id, anchor_text, target_block_id }\`.

Réponds SEULEMENT par un appel à \`submit_review_findings({findings: [...]})\` puis stop.`,
};

const REVIEWER_NAMES: Record<ReviewKind, string> = {
  legal: "wp-editor-reviewer-legal-v1",
  fact: "wp-editor-reviewer-fact-v1",
  links: "wp-editor-reviewer-links-v1",
};

const cachedReviewerIds: Partial<Record<ReviewKind, string>> = {};

export async function getOrCreateReviewerAgent(kind: ReviewKind): Promise<string> {
  if (cachedReviewerIds[kind]) return cachedReviewerIds[kind]!;
  const name = REVIEWER_NAMES[kind];
  // Try to find an existing agent
  try {
    const existing = await (client.beta as any).agents.list();
    for await (const a of existing as any) {
      if (
        a.name === name &&
        a.system === REVIEWER_PROMPTS[kind]
      ) {
        cachedReviewerIds[kind] = a.id;
        return a.id;
      }
    }
  } catch {
    // ignore — fall through to create
  }
  const tools: any[] = [{ type: "agent_toolset_20260401" }, SUBMIT_TOOL];
  // Only the links reviewer gets wp_list_posts (server-executed custom tool).
  if (kind === "links") {
    tools.push({
      type: "custom" as const,
      name: "wp_list_posts",
      description:
        "Liste les articles WordPress publiés. Filtres : status, search, per_page (max 50).",
      input_schema: {
        type: "object",
        properties: {
          status: { type: "string" },
          search: { type: "string" },
          per_page: { type: "integer" },
        },
      },
    });
  }
  const agent = await client.beta.agents.create({
    name,
    model: { id: "claude-sonnet-4-6", speed: "standard" } as any,
    system: REVIEWER_PROMPTS[kind],
    tools: tools as any,
  });
  cachedReviewerIds[kind] = agent.id;
  console.log(`[reviewers] created ${kind} agent ${agent.id}`);
  return agent.id;
}

export async function getReviewerEnvironment(): Promise<string> {
  return getOrCreateEnvironment();
}

export const REVIEW_SUBMIT_TOOL_NAME = "submit_review_findings";
