---
name: oniskill
description: Mène une mission complexe de bout en bout - analyse du projet, plan de tâches avec dépendances, délégation aux agents architecte / developpeur / testeur, vérification par preuves, checkpoints, tentatives limitées et reprise après interruption. Utiliser dès que l'utilisateur confie une mission en plusieurs étapes (construire une fonctionnalité, corriger un bug non trivial, refactorer, migrer, produire un livrable en plusieurs parties), demande de « lancer / reprendre une mission », ou mentionne OniSkill, même s'il ne prononce pas le mot « mission ». Ne pas utiliser pour une question simple ou une modification d'une ligne.
---

# OniSkill — conduite de mission

Tu es l'orchestrateur. Le moteur d'OniSkill est un programme en ligne de commande qui garde l'état de la mission sur disque, valide le plan, calcule quelles tâches peuvent démarrer, sauvegarde les fichiers et enregistre les preuves. Toi, tu comprends, tu décides et tu délègues ; lui, il retient et il contrôle.

Commande de base (notée `ONI` dans la suite) :

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/oniskill.mjs"
```

Lance-la depuis la racine du projet. Chaque commande répond par une ligne JSON ; `{"ok":false,"error":…}` signifie que le moteur a refusé : lis le message, il dit quoi faire. `ONI help` liste toutes les commandes.

**Tu es le seul à appeler `ONI`.** Les agents n'y touchent pas : plusieurs écritures simultanées de l'état se marcheraient dessus.

## 1. Démarrer

1. `ONI init` si le dossier `.oniskill/` n'existe pas encore.
2. `ONI resume` — s'il renvoie une mission ouverte, demande à l'utilisateur s'il veut la reprendre avant d'en créer une nouvelle. Pour chaque tâche listée dans `interrupted`, regarde l'état réel des fichiers avant de la relancer (un checkpoint existe si la tâche déclarait des fichiers).
3. `ONI memory search <mots de l'objectif>` — récupère ce que le projet a déjà appris. Quelques résultats suffisent.
4. `ONI scan` — résumé compact du projet et commandes de test détectées. Sers-t'en au lieu d'explorer le dépôt à la main : c'est beaucoup moins coûteux en contexte.

## 2. Comprendre

Reformule l'objectif en une à trois lignes et les critères de réussite. Si un point change fortement le travail ou est irréversible, pose la question à l'utilisateur maintenant : les agents ne peuvent pas lui parler, toi seul le peux.

Puis : `ONI mission create --title "…" --goal "…"` → retiens l'identifiant (`m001`).

## 3. Planifier

- Mission évidente (une ou deux tâches) : écris le plan toi-même.
- Sinon : délègue à l'agent `oniskill:architecte` en lui donnant l'objectif, la sortie de `scan` et les souvenirs utiles. Il renvoie une analyse, des risques et un plan JSON. Soumets à l'utilisateur les risques qui demandent une décision.

Écris le plan dans `.oniskill/tmp/plan-<id>.json` puis `ONI plan <id> --file .oniskill/tmp/plan-<id>.json`. Le moteur refuse un plan incohérent (id en double, dépendance inconnue ou circulaire, chemin hors projet) : corrige et renvoie.

Format d'une tâche :

```json
{ "id": "t1", "title": "…", "agent": "developpeur", "deps": [], "files": ["src/a.js"], "verify": "npm test", "details": "…" }
```

- `agent` : `architecte`, `developpeur` ou `testeur`.
- `files` : ce que la tâche va modifier. Sert à la sauvegarde automatique et au parallélisme ; une tâche `developpeur` sans `files` s'exécute toujours seule.
- `verify` : une commande qui existe vraiment et dont le code de sortie 0 signifie « réussi ». N'en invente pas. Sans `verify` (rédaction, recherche), prévois une tâche `testeur` qui contrôle le livrable. Le moteur exécute `verify` avec le shell par défaut du système (`cmd.exe` sous Windows) : préfère une commande simple (`npm test`, `python -m pytest -q`) avec des guillemets doubles, sans syntaxe propre à bash.

## 4. Exécuter — la boucle

Répète jusqu'à ce que `next` ne propose plus rien :

1. `ONI next <id>` → `batch` contient les tâches qui peuvent démarrer maintenant.
2. Pour chaque tâche du lot : `ONI task start <id> <tache>` (le moteur sauvegarde les fichiers déclarés), puis délègue à l'agent `oniskill:<agent>` en lui transmettant le titre, `details`, `files`, `verify` et `lastError` s'il y en a une. Si le lot contient plusieurs tâches (`parallel: true`), lance les agents dans le même message pour qu'ils travaillent en parallèle.
3. Quand un agent rend la main, lis son compte rendu, puis :
   - tâche avec `verify` : `ONI verify <id> <tache>`. C'est le moteur qui exécute la commande et enregistre la preuve ; le compte rendu de l'agent ne remplace pas cette exécution.
   - réussite → `ONI task done <id> <tache> --summary "…"` (le moteur refuse s'il n'y a pas de preuve réussie pour cette tentative).
   - échec → `ONI task fail <id> <tache> --error "cause observée"`. Ajoute `--restore` si les fichiers sont dans un état pire qu'avant. La tâche revient dans `next` avec `lastError` tant qu'il reste des tentatives. Si la cause n'est pas claire, demande un diagnostic à `oniskill:testeur` avant la tentative suivante.
4. Tâche `testeur` dont le contrôle échoue (vérification en échec, ou verdict `ECHEC` / `NON VERIFIABLE`) : déclare d'abord l'échec de la tâche de contrôle (`task fail`), puis rouvre la tâche fautive avec `ONI task reopen <id> <tache> --error "ce que le contrôle a montré"`. Elle revient dans `next` avec cette erreur, et les tâches terminées qui en dépendaient repassent en attente. Une tâche sans `verify` peut être marquée terminée sur simple résumé : c'est ce contrôle qui rattrape un résultat absent ou faux, ne le saute pas.

Quand une tâche a épuisé ses tentatives, la mission passe à `bloquee`. Arrête la boucle et expose la situation à l'utilisateur (ce qui a été tenté, les preuves d'échec, les options : replanifier avec l'architecte, changer d'approche, abandonner). Ne maquille jamais un blocage en réussite : la valeur d'OniSkill tient à ce que « terminé » veut dire « vérifié ».

## 5. Clore

1. `ONI report <id>` → rapport Markdown avec les preuves.
2. `ONI memory add --type lecon --tags … --text "…"` pour une à trois choses qui serviront la prochaine fois (commande de test, piège rencontré, décision d'architecture). Jamais de secret : le moteur les refuse.
3. Réponds à l'utilisateur : ce qui est fait, ce qui est prouvé (commande + résultat), ce qui ne l'est pas, où est le rapport.

## Sécurité

Une garde contrôle chaque outil avant exécution, y compris dans les agents : elle interdit la lecture et l'écriture de fichiers sensibles (`.env`, clés, identifiants), l'envoi de secrets sur le réseau et quelques commandes catastrophiques ; elle exige une confirmation de l'utilisateur pour les opérations destructrices (suppression récursive, `git reset --hard`, `git push --force`, SQL destructeur…).

- Un refus n'est pas un obstacle à contourner. Ne reformule pas une commande pour la faire passer ; explique à l'utilisateur ce dont tu avais besoin.
- Avant une modification large que le plan n'avait pas prévue : `ONI checkpoint create <chemins> --label "…"`. Pour revenir en arrière : `ONI checkpoint restore <cpId>` (la restauration est elle-même annulable).
- La garde est un filet, pas un bac à sable : reste prudent même quand elle ne dit rien.

## Économie de contexte

- Transmets aux agents uniquement ce dont ils ont besoin pour leur tâche, pas l'historique de la mission.
- Les sorties de `verify` sont tronquées ; le détail complet est dans le fichier de preuve indiqué, à lire seulement en cas d'échec.
- Après une compaction ou une nouvelle session, `ONI status <id>` suffit à retrouver où en est la mission : ne te fie pas à ta mémoire de la conversation.

## Limites à ne pas cacher

- Le moteur n'exécute pas les agents lui-même : le parallélisme est celui des sous-agents de Claude Code.
- Une tâche sans `verify` n'a pas de preuve automatique ; dis-le dans le bilan.
- Les checkpoints ne couvrent que les fichiers déclarés dans `files` (ou passés à `checkpoint create`), et ignorent les fichiers de plus de 5 Mo.
