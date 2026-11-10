# Installation

## Prérequis

- Claude Code installé et connecté.
- Node.js 18 ou plus récent, accessible dans le terminal : `node --version`.

## Installer (Windows, macOS, Linux)

1. Décompressez l'archive dans un dossier **définitif**, par exemple `C:\Users\<vous>\oniskill-marketplace`. Claude Code lit le plugin à cet endroit : si vous déplacez ou supprimez le dossier, le plugin disparaît.

2. Vérifiez que tout fonctionne sur votre machine :

   ```
   node C:\Users\<vous>\oniskill-marketplace\oniskill\scripts\oniskill.mjs doctor
   ```

   La réponse doit commencer par `{"ok":true`. Chaque contrôle en échec indique sa cause.

3. Déclarez le dossier puis installez le plugin :

   ```
   claude plugin marketplace add C:\Users\<vous>\oniskill-marketplace
   claude plugin install oniskill@oniskill-local
   ```

4. Contrôlez : `claude plugin details oniskill` doit afficher 1 skill, 3 agents et 2 hooks.

5. Ouvrez Claude Code dans un projet et tapez `/oniskill:oniskill` suivi de votre mission.

### Essayer sans installer

```
claude --plugin-dir C:\Users\<vous>\oniskill-marketplace\oniskill
```

Le plugin n'est chargé que pour cette session.

## Premier contrôle dans Claude Code

Ces vérifications n'ont pas pu être faites avant la livraison (voir [VALIDATION.md](VALIDATION.md)) ; faites-les une fois, dans un dossier d'essai :

| Essai | Résultat attendu |
|---|---|
| Créez un fichier `.env` puis demandez « lis le fichier .env » | Refus avec un message commençant par `[OniSkill]` |
| Demandez « supprime le dossier essai avec rm -rf essai » | Demande de confirmation `[OniSkill]` |
| Tapez `/agents` | `oniskill:architecte`, `oniskill:developpeur`, `oniskill:testeur` apparaissent |
| Lancez une petite mission, fermez Claude Code au milieu, rouvrez-le | Claude signale la mission non terminée |

Si le premier essai ne produit aucun refus, le hook ne s'exécute pas : vérifiez que `node` est accessible depuis le terminal qui lance Claude Code, puis `claude plugin details oniskill`.

## Lancer les tests

```
cd C:\Users\<vous>\oniskill-marketplace\oniskill
npm test
```

## Mettre à jour ou désinstaller

- Mise à jour : remplacez le contenu du dossier `oniskill`, puis `claude plugin marketplace update oniskill-local`.
- Désinstallation : `claude plugin uninstall oniskill@oniskill-local`, puis `claude plugin marketplace remove oniskill-local`.
- Les données de vos missions restent dans le dossier `.oniskill/` de chaque projet ; supprimez-le si vous n'en voulez plus.
