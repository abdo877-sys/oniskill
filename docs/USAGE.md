# Guide d'utilisation

## Lancer une mission

Dans Claude Code, à la racine de votre projet :

```
/oniskill:oniskill Ajoute l'export CSV à la page des rapports, avec des tests
```

Vous pouvez aussi simplement décrire une tâche en plusieurs étapes : Claude charge le skill de lui-même quand la demande s'y prête.

Déroulement :

1. **Analyse** — scan du projet, relecture de la mémoire, reformulation de l'objectif. Claude vous pose ses questions à ce moment-là.
2. **Plan** — l'architecte propose des tâches ; le moteur valide le plan.
3. **Exécution** — le développeur réalise chaque tâche (plusieurs en parallèle quand elles ne touchent pas les mêmes fichiers). Les fichiers annoncés sont sauvegardés avant chaque tâche.
4. **Vérification** — le moteur exécute la commande de test de chaque tâche et enregistre la preuve. Échec : nouvelle tentative avec l'erreur précédente, 3 tentatives au plus par défaut.
5. **Bilan** — rapport dans `.oniskill/missions/<id>/report.md`.

Si une tâche épuise ses tentatives, la mission est **bloquée** : Claude s'arrête et vous expose les options. Il ne déclare pas une réussite qu'il n'a pas prouvée.

## Reprendre après une interruption

Rouvrez Claude Code dans le projet : il signale la mission ouverte. Dites « reprends la mission ». Les tâches coupées en cours de route sont remises en attente sans perdre de tentative, et leur checkpoint permet de revenir à l'état d'avant.

## Ce que la garde de sécurité fait

| Situation | Réaction |
|---|---|
| Lire ou écrire `.env`, clés privées, identifiants (`.ssh`, `.aws`, `*.pem`, `credentials.json`…) | Refus |
| Envoyer sur le réseau un fichier sensible, les variables d'environnement ou un secret en clair | Refus |
| `rm -rf /`, formatage de disque, suppression récursive hors du projet | Refus |
| Suppression récursive, `git reset --hard`, `git push --force`, SQL destructeur, `sudo`, publication de paquet, script téléchargé puis exécuté… | Confirmation demandée |
| Modifier directement l'état interne `.oniskill/` ou désactiver la garde | Refus ou confirmation |
| Tout le reste | Permissions habituelles de Claude Code |

Les refus et confirmations sont journalisés dans `.oniskill/guard.log`.

## Réglages

Depuis la racine du projet (`ONI` = `node <dossier du plugin>/scripts/oniskill.mjs`) :

```
ONI config get
ONI config set maxAttempts 2            # tentatives par tâche
ONI config set maxParallel 2            # tâches simultanées
ONI config set verifyTimeoutSec 600     # durée maximale d'une vérification
ONI config set guard.sensitiveMode ask  # confirmer au lieu de refuser pour les fichiers sensibles
```

Pour les listes (`guard.extraSensitive`, `guard.extraAsk`, `scanIgnore`), le plus simple est de modifier `.oniskill/config.json` à la main, les guillemets étant pénibles dans un terminal Windows :

```json
{
  "guard": {
    "extraSensitive": ["clients\\.csv$"],
    "extraAsk": ["deploy\\.ps1"]
  }
}
```

Ce sont des expressions régulières : la première traite tout chemin finissant par `clients.csv` comme sensible, la seconde demande confirmation pour toute commande mentionnant `deploy.ps1`.

## Commandes utiles à la main

```
ONI doctor                      # diagnostic de la machine
ONI mission list                # toutes les missions
ONI status m001                 # détail d'une mission
ONI report m001                 # (re)génère le rapport
ONI checkpoint list             # sauvegardes disponibles
ONI checkpoint restore cp0003   # revenir en arrière (annulable)
ONI memory list                 # ce que le projet a retenu
ONI memory remove k4
ONI mission cancel m001
```

## Ce qui est stocké dans `.oniskill/`

| Chemin | Contenu |
|---|---|
| `config.json` | Vos réglages |
| `scan.json` | Dernier résumé du projet |
| `memory.jsonl` | Mémoire du projet (une note par ligne) |
| `missions/<id>/mission.json` | État de la mission |
| `missions/<id>/evidence/` | Preuves : commande, code de sortie, sortie, durée |
| `missions/<id>/report.md` | Rapport |
| `checkpoints/<id>/` | Copies de fichiers avant modification |
| `guard.log` | Refus et confirmations de la garde |

Le fichier `.oniskill/.gitignore` exclut déjà les checkpoints et le journal de git. La mémoire et les missions peuvent être versionnées si vous le souhaitez.

## Missions qui ne sont pas du code

Rédaction, recherche, organisation de fichiers : le déroulement est le même, mais il n'existe pas de test automatique. La preuve se limite alors au résumé de la tâche et au contrôle du livrable par l'agent testeur ; le rapport l'indique par « pas de test automatique ».
