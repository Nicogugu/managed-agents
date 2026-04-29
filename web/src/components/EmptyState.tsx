type Starter = { emoji: string; label: string; description: string; value: string };

const STARTERS: Starter[] = [
  {
    emoji: "💡",
    label: "Propose-moi 5 idées d'articles",
    description: "L'agent regarde l'existant et te suggère des angles complémentaires",
    value:
      "Phase DISCOVER : regarde les articles WordPress existants et propose-moi 5 idées d'articles qui complètent (pas dupliquent) le contenu actuel. Émets un bloc ```ask``` avec les 5 options pour que je clique celle que je préfère.",
  },
  {
    emoji: "✍",
    label: "Rédige un article complet maintenant",
    description: "L'agent demande le sujet via boutons et lance le pipeline",
    value:
      "Je veux un nouvel article. Émets un bloc ```ask``` pour me demander le format/longueur et la thématique parmi des choix cliquables.",
  },
  {
    emoji: "🔄",
    label: "Mets à jour un article existant",
    description: "L'agent liste les articles cliquables",
    value:
      "Je veux mettre à jour un article existant. Liste les 10 articles les plus récents via /api/wp/posts et émets un bloc ```ask``` avec les options cliquables.",
  },
  {
    emoji: "🎨",
    label: "Crée une brand voice depuis URLs",
    description: "Donne 1-3 URLs d'articles dont tu aimes le style → l'agent en fait un guide réutilisable",
    value:
      "Je veux créer une nouvelle brand voice à partir d'URLs. Émets un bloc ```ask``` pour me demander : (1) quel type de page (article, tutorial, news, comparison, case-study, ou un nouveau slug à inventer) (2) ensuite je te donnerai 1 à 3 URLs d'articles dont j'aime le style. Tu les fetcheras, analyseras le ton/structure/vocabulaire, et écriras le résultat dans /mnt/memory/voices/{slug}.md avec sections Ton, Structure, Vocabulaire, Exemples, Quand l'utiliser.",
  },
  {
    emoji: "📒",
    label: "Mes préférences / leçons",
    description: "Voir et éditer les règles cumulées que tu m'as apprises (chargées auto à chaque session)",
    value:
      "Lis /mnt/memory/wp-editor-knowledge/lessons.md et affiche-moi son contenu actuel. Ensuite émets un bloc ```ask``` pour que je puisse choisir : (a) ajouter une nouvelle règle, (b) supprimer une règle existante, (c) tout est bon, on continue.",
  },
  {
    emoji: "🖼️",
    label: "Génère juste une image",
    description: "Sans article, juste une image dans WP Media",
    value:
      "Je veux générer une image (sans article). Émets un bloc ```ask``` pour me demander le sujet/style parmi des choix.",
  },
];

export function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (label: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="py-6 sm:py-10">
      <div className="text-center mb-6">
        <div className="text-text-secondary text-md mb-1">Article Code</div>
        <div className="text-text-muted text-sm">
          Clique pour démarrer — l'agent te guide en mode boutons.
        </div>
      </div>
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.label, s.value)}
            disabled={disabled}
            className="surface rounded-lg px-4 py-3 text-left hover:bg-bg-tertiary hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-start gap-3"
          >
            <span className="text-xl flex-shrink-0 leading-none mt-0.5">{s.emoji}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-text-primary font-medium">{s.label}</span>
              <span className="block text-xs text-text-tertiary mt-0.5">{s.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
