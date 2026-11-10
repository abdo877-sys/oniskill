#!/usr/bin/env node
// Hook SessionStart : si une mission est restée ouverte, le signale à Claude en une ligne par mission.
// Ne modifie rien : la remise en attente des tâches se fait par la commande « resume ».
import fs from 'node:fs';
import { findProjectDir, statePath } from './lib/store.mjs';
import { openMissions, summarize } from './lib/mission.mjs';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const projectDir = findProjectDir(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (fs.existsSync(statePath(projectDir))) {
    const open = openMissions(projectDir).map(summarize);
    if (open.length) {
      const lines = open.map((m) => `- ${m.id} « ${m.title} » : ${m.status}, ${m.terminee ?? 0}/${m.tasks} tâches terminées${m.en_cours ? `, ${m.en_cours} interrompue(s)` : ''}`);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart',
        additionalContext: `[OniSkill] Mission(s) non terminée(s) dans ce projet :\n${lines.join('\n')}\nSi l'utilisateur veut continuer, utiliser le skill oniskill (commande « resume » puis « next »). Ne pas reprendre sans son accord.` } }));
    }
  }
} catch { /* un hook d'information ne doit jamais gêner le démarrage */ }
