# OniSkill V1

Plugin pour Claude Code qui transforme une demande complexe en mission suivie : analyse du projet, plan de tâches avec dépendances, délégation à trois agents (architecte, développeur, testeur), vérification par preuves enregistrées, sauvegardes avant modification, tentatives limitées, reprise après interruption et garde de sécurité sur chaque outil.

Aucune dépendance : Node.js (18 ou plus) et Claude Code suffisent. Rien n'est envoyé ailleurs ; tout l'état vit dans le dossier `.oniskill/` de votre projet.

- Installation : [docs/INSTALL.md](docs/INSTALL.md)
- Utilisation : [docs/USAGE.md](docs/USAGE.md)
- Ce qui a été réellement vérifié, et ce qui ne l'a pas été : [docs/VALIDATION.md](docs/VALIDATION.md)

## Comment c'est construit

| Élément | Fichier | Rôle |
|---|---|---|
| Skill principal | `skills/oniskill/SKILL.md` | Protocole suivi par Claude (l'orchestrateur) |
| Agents | `agents/architecte.md`, `developpeur.md`, `testeur.md` | Trois rôles aux outils limités |
| Garde de sécurité | `hooks/hooks.json` → `scripts/guard-hook.mjs` | Contrôle chaque outil avant exécution |
| Rappel de reprise | `hooks/hooks.json` → `scripts/session-hook.mjs` | Signale une mission ouverte au démarrage |
| Moteur | `scripts/oniskill.mjs` + `scripts/lib/` | État, plan, tâches, preuves, checkpoints, mémoire, scan |
| Tests | `tests/` | Unitaires, intégration, sécurité, reprise |

### Qui fait quoi

Claude comprend la mission, la découpe (avec l'agent architecte) et délègue. Le moteur ne « réfléchit » pas : il **retient et contrôle**. Il refuse un plan incohérent, calcule quelles tâches peuvent tourner ensemble, sauvegarde les fichiers, exécute lui-même les commandes de vérification et refuse de marquer une tâche terminée sans preuve réussie.

### Choix techniques et raisons

- **Plugin plutôt que skill seul** : les agents et les hooks ne peuvent pas être livrés dans un skill. Le plugin regroupe tout en un paquet installable.
- **Node sans dépendance** : fonctionne à l'identique sous Windows, macOS et Linux, sans `npm install`. Les hooks sont lancés en « exec form » (`node` + arguments), ce qui évite de dépendre de Git Bash ou de PowerShell.
- **État en fichiers JSON dans le projet** : lisible, sauvegardable, sans base de données. Écriture atomique (fichier temporaire puis renommage) pour qu'un arrêt brutal ne laisse pas un fichier à moitié écrit.
- **Seul l'orchestrateur met à jour l'état** : les agents peuvent travailler en parallèle, mais aucun ne touche à `.oniskill/`, ce qui évite deux écritures simultanées.
- **Permissions des agents par liste d'outils** : Claude Code ignore `permissionMode` et `hooks` dans les agents de plugin ; la restriction se fait donc par `tools` (l'architecte n'a ni écriture ni shell, le testeur n'a pas d'outil d'écriture) et par la garde commune.
- **Checkpoints par copie de fichiers** plutôt que par git : fonctionne dans un projet sans git et ne touche pas à votre historique.
- **Mémoire en JSONL avec recherche par mots-clés** : pas de base vectorielle (budget et dépendances nuls). Suffisant pour quelques centaines de notes courtes.
- **Sorties compactes** : chaque commande renvoie une ligne JSON ; les sorties de test sont tronquées et le détail reste sur disque. Coût permanent mesuré par Claude Code : environ 320 jetons par session.

### Limites connues

- La garde analyse le texte des commandes. C'est un filet, pas un bac à sable : une commande déguisée (script intermédiaire, encodage) peut passer. Les permissions natives de Claude Code restent votre première protection.
- Si Node est introuvable ou si le hook plante au lancement, Claude Code laisse passer l'outil (comportement par défaut des hooks). Lancez `doctor` après l'installation.
- Le testeur dispose du shell : il n'a pas d'outil d'écriture, mais rien n'empêche techniquement une redirection shell. Sa consigne l'interdit ; ce n'est pas une barrière technique.
- Le moteur ne lance pas les agents : le parallélisme est celui des sous-agents de Claude Code.
- Une tâche sans commande de vérification n'a pas de preuve automatique ; le rapport l'indique.
- Les checkpoints couvrent uniquement les fichiers déclarés dans le plan, et ignorent les fichiers de plus de 5 Mo.
- Deux sessions Claude Code qui pilotent la même mission en même temps ne sont pas gérées.

## Développement

```
npm test                         # toute la suite
node scripts/oniskill.mjs doctor # diagnostic de la machine
claude plugin validate .         # validation du plugin par Claude Code
```
