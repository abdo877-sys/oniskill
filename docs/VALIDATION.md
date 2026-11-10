# Rapport de validation — OniSkill V1

Ce rapport sépare ce qui a été **exécuté et observé** de ce qui ne l'a pas été. Rien n'y est déclaré « validé » sur la seule base du code écrit.

Environnement de validation : Linux, Node 22.23.4, Claude Code 2.1.322 (installé mais **non connecté à un compte**).

## Validé

| Fonctionnalité | Comment c'est prouvé |
|---|---|
| Moteur de mission : création, plan, démarrage, fin, échec, annulation | Tests d'intégration via la vraie CLI dans des processus séparés |
| Planificateur : id en double, agent inconnu, dépendance inconnue ou circulaire, chemin hors projet | Tests unitaires |
| Dépendances et lots parallèles sans conflit de fichiers | Test d'intégration (6 tâches, conflits de dossier, limite `maxParallel`) |
| Vérification : la commande est réellement exécutée, preuve écrite sur disque (commande, code de sortie, sortie, durée) | Test d'intégration avec un vrai test en échec puis corrigé |
| Impossible de terminer une tâche sans preuve réussie pour la tentative en cours | Test d'intégration (refus observé dans les deux cas : preuve en échec, preuve absente) |
| Tentatives limitées, blocage de la mission, replanification | Test d'intégration |
| Réouverture d'une tâche quand le contrôle échoue | Test d'intégration + mission réelle n° 2 |
| Délai dépassé d'une vérification | Test d'intégration |
| Checkpoints : restauration exacte, annulation de la restauration, copie corrompue détectée | Tests unitaires |
| Mémoire persistante : relue par un autre processus, recherche sans accents, plafond avec archive, ligne abîmée tolérée | Tests unitaires |
| Scanner : commandes de test détectées, dossiers ignorés | Tests unitaires |
| Configuration : valeurs validées, fichier corrompu toléré | Tests unitaires |
| Garde : 18 commandes catastrophiques refusées, 7 fuites de secrets refusées, 26 opérations destructrices soumises à confirmation, 20 commandes courantes non gênées | Tests de sécurité |
| Garde : fichiers sensibles (chemins Unix et Windows), état interne protégé, requêtes web contenant un secret | Tests de sécurité |
| Hook `PreToolUse` : lancé comme un vrai processus avec l'entrée JSON décrite par la documentation de Claude Code ; sortie au format attendu ; panne → confirmation demandée | Tests de sécurité |
| La commande `verify` du plan passe elle aussi par la garde ; la mémoire refuse les secrets | Tests de sécurité |
| Reprise : tâche interrompue remise en attente sans perte de tentative ; processus tué pendant une vérification ; fichier temporaire tronqué ; `mission.json` illisible | Tests de reprise |
| Hook `SessionStart` : signale une mission ouverte, se tait sinon | Test de reprise (processus réel) |
| Structure du plugin | `claude plugin validate` : « Validation passed » |
| Installation depuis un dossier local | `claude plugin marketplace add` puis `claude plugin install` exécutés dans une configuration isolée : 1 skill, 3 agents, 2 hooks reconnus ; coût permanent estimé par Claude Code ≈ 320 jetons |
| Commande `doctor` | Test dédié + exécution réelle |

Suite automatisée : **30 tests, 30 réussis**, exécutée plusieurs fois de suite sans échec intermittent (`npm test`).

### Défauts trouvés par les tests, puis corrigés

1. `curl -F file=@.env …` n'était pas reconnu comme fuite (le `@` collait au nom du fichier).
2. Une écriture shell dans `.oniskill/missions/` n'était pas détectée.
3. Une mission bloquée repassait « en cours » dès qu'une autre tâche démarrait.
4. Un `node --test` lancé par `verify` depuis un autre `node --test` ne testait rien et renvoyait un **faux succès** ; `verify` nettoie maintenant la variable d'environnement en cause.
5. Aucun moyen de rouvrir une tâche terminée quand le contrôle final échoue ; commande `task reopen` ajoutée.

### Missions réelles menées avec le moteur

Deux missions ont été conduites sur le dépôt d'OniSkill lui-même, en suivant le protocole de `SKILL.md` et en passant par la CLI pour chaque étape :

- **m001 — commande `doctor` et documentation** : 3 tâches, dont 2 lancées dans le même lot parallèle ; 3 preuves réussies.
- **m002 — ce rapport (mission sans code)** : la tâche de rédaction avait été marquée terminée alors que le fichier n'existait pas ; le contrôle l'a détecté (preuve d'échec enregistrée), la tâche a été rouverte, refaite, puis recontrôlée.

Réserve importante : ces missions ont été orchestrées par Claude dans un environnement de travail distant, **pas** dans une session Claude Code avec le plugin chargé. Les trois agents du plugin n'y ont donc pas été invoqués ; leurs rôles ont été tenus par le même Claude.

## Non validé — à vérifier chez vous

| Point | Pourquoi | Comment vérifier |
|---|---|---|
| Fonctionnement dans une session Claude Code réelle : déclenchement du skill, délégation aux agents `oniskill:*`, sous-agents en parallèle | Claude Code n'était pas connecté à un compte dans l'environnement de validation | Tableau « Premier contrôle » de [INSTALL.md](INSTALL.md), puis une petite mission |
| Déclenchement effectif des hooks par Claude Code, et affichage de la demande de confirmation | Même raison ; les hooks n'ont été testés que comme processus isolés | Essais `.env` et `rm -rf` du tableau « Premier contrôle » |
| **Windows** | Aucune exécution sous Windows. Le code est écrit pour (chemins, hooks sans shell, `cmd.exe`) et les tests couvrent des chemins et commandes Windows, mais seulement comme texte | `doctor` puis `npm test` sur votre machine |
| Node 18 et 20 | Seul Node 22 a été utilisé | `npm test` |
| Qualité du déclenchement automatique du skill et comparaison avec/sans skill | Demande des sessions Claude Code réelles | Peut être fait dans un second temps |
| Exhaustivité de la garde | Seule la liste testée est garantie ; ce n'est pas un audit de sécurité | Ajouter vos propres règles (`guard.extraAsk`, `guard.extraSensitive`) |
| Deux sessions pilotant la même mission en même temps | Non géré, non testé | À éviter |

## Correspondance avec la mission fondatrice

| Étape demandée | État |
|---|---|
| 1. Recherche et conception | Fait (documentation actuelle de Claude Code consultée ; architecture, limites et risques dans le README) |
| 2. Fondations (skill, moteur, planificateur, tâches, configuration, scanner, mémoire) | Fait et testé |
| 3. Trois agents | Écrits et reconnus par Claude Code ; **non exécutés en session réelle** |
| 4. Autonomie (décomposition, séquentiel/parallèle, dépendances, checkpoints, erreurs, reprise) | Moteur fait et testé ; la décomposition et le parallélisme effectif reposent sur Claude Code, non testés en session réelle |
| 5. Vérification | Fait et testé |
| 6. Sécurité | Fait et testé hors session ; confirmation humaine **non observée** dans l'interface |
| 7. Tests unitaires, d'intégration, de sécurité, de reprise | Fait ; « missions réelles » : deux, avec la réserve ci-dessus |
