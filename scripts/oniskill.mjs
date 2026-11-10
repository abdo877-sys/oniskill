#!/usr/bin/env node
// CLI d'OniSkill. Sortie : toujours une seule valeur JSON (compacte), code de sortie 0 = succès, 1 = erreur.
import fs from 'node:fs';
import path from 'node:path';
import { findProjectDir, statePath, readJson, OniError } from './lib/store.mjs';
import { loadConfig, setConfig } from './lib/config.mjs';
import { scanProject } from './lib/scanner.mjs';
import * as mission from './lib/mission.mjs';
import { runVerify } from './lib/verify.mjs';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './lib/checkpoint.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { addMemory, searchMemory, loadMemory, removeMemory } from './lib/memory.mjs';

const HELP = `OniSkill — moteur de mission
  init                                   crée .oniskill/ dans le dossier courant
  scan                                   résumé du projet + commandes de test détectées
  mission create --title T --goal G      nouvelle mission
  mission list | status [id] | cancel <id>
  plan <id> --file plan.json             enregistre/valide le plan (ou JSON sur stdin)
  next [id]                              tâches prêtes (lot parallèle possible)
  task start <id> <tache>                démarre (checkpoint automatique des fichiers déclarés)
  task done  <id> <tache> --summary S    termine (preuve réussie exigée si la tâche a « verify »)
  task fail  <id> <tache> --error E [--restore]
  task reopen <id> <tache> --error E     rouvre une tâche terminée dont le résultat est mauvais
  verify <id> <tache>                    exécute la vérification et enregistre la preuve
  resume                                 remet en attente les tâches interrompues
  report <id>                            écrit le rapport Markdown
  checkpoint create <chemins…> [--label L] | list | restore <cpId>
  memory add --text T [--type fait|decision|lecon|preference] [--tags a,b] | search <mots> | list | remove <id>
  config get | set <cle> <valeur>
  doctor                                 vérifie que tout fonctionne sur cette machine (utilisable avant init)
Option globale : --project <dossier>`;

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

const str = (v, name) => { if (typeof v !== 'string') throw new OniError(`Option --${name} manquante.`); return v; };
const need = (v, what) => { if (!v) throw new OniError(`Argument manquant : ${what}.`); return v; };

function run(argv) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, sub, ...rest] = pos;
  if (!cmd || cmd === 'help' || flags.help) return { help: HELP };
  const projectDir = typeof flags.project === 'string' ? path.resolve(flags.project) : findProjectDir();
  if (cmd === 'doctor') { const d = runDoctor(); if (!d.ok) process.exitCode = 1; return d; }
  if (cmd === 'init') {
    fs.mkdirSync(statePath(projectDir), { recursive: true });
    const gi = statePath(projectDir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'checkpoints/\ntmp/\nguard.log\n');
    return { initialized: statePath(projectDir) };
  }
  if (!fs.existsSync(statePath(projectDir))) throw new OniError(`Pas de dossier .oniskill ici (${projectDir}). Lancer d'abord « init ».`);
  const cfg = loadConfig(projectDir);

  switch (cmd) {
    case 'scan': return scanProject(projectDir, cfg);
    case 'mission':
      if (sub === 'create') return mission.summarize(mission.createMission(projectDir, { title: str(flags.title, 'title'), goal: str(flags.goal, 'goal') }));
      if (sub === 'list') return mission.listMissions(projectDir).map(mission.summarize);
      if (sub === 'status') return status(projectDir, rest[0]);
      if (sub === 'cancel') return mission.cancelMission(projectDir, need(rest[0], 'identifiant de mission'));
      break;
    case 'status': return status(projectDir, sub);
    case 'plan': {
      const raw = typeof flags.file === 'string' ? fs.readFileSync(path.resolve(flags.file), 'utf8') : fs.readFileSync(0, 'utf8');
      let plan;
      try { plan = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new OniError(`Plan : JSON invalide (${e.message}).`); }
      const m = mission.setPlan(projectDir, need(sub, 'identifiant de mission'), Array.isArray(plan) ? plan : plan.tasks);
      return mission.summarize(m);
    }
    case 'next': return mission.nextBatch(projectDir, cfg, sub);
    case 'task': {
      const [id, taskId] = rest;
      need(id, 'identifiant de mission'); need(taskId, 'identifiant de tâche');
      if (sub === 'start') return mission.startTask(projectDir, cfg, id, taskId);
      if (sub === 'done') return mission.completeTask(projectDir, id, taskId, str(flags.summary, 'summary'));
      if (sub === 'reopen') return mission.reopenTask(projectDir, cfg, id, taskId, str(flags.error, 'error'));
      if (sub === 'fail') return mission.failTask(projectDir, cfg, id, taskId, str(flags.error, 'error'), { restore: Boolean(flags.restore) });
      break;
    }
    case 'verify': return runVerify(projectDir, cfg, need(sub, 'identifiant de mission'), need(rest[0], 'identifiant de tâche'));
    case 'resume': return mission.resumeMissions(projectDir);
    case 'report': return mission.writeReport(projectDir, need(sub, 'identifiant de mission'));
    case 'checkpoint':
      if (sub === 'create') { if (!rest.length) throw new OniError('Indiquer au moins un chemin.'); const c = createCheckpoint(projectDir, cfg, rest, typeof flags.label === 'string' ? flags.label : ''); return { id: c.id, files: c.entries.length, skipped: c.entries.filter((e) => e.skipped).map((e) => e.path) }; }
      if (sub === 'list') return listCheckpoints(projectDir);
      if (sub === 'restore') return restoreCheckpoint(projectDir, cfg, need(rest[0], 'identifiant de checkpoint'));
      break;
    case 'memory':
      if (sub === 'add') return addMemory(projectDir, cfg, { text: str(flags.text, 'text'), type: typeof flags.type === 'string' ? flags.type : 'fait', tags: typeof flags.tags === 'string' ? flags.tags.split(',').map((s) => s.trim()).filter(Boolean) : [], mission: typeof flags.mission === 'string' ? flags.mission : null });
      if (sub === 'search') return searchMemory(projectDir, rest.join(' '), Number(flags.limit) || 5);
      if (sub === 'list') return loadMemory(projectDir).slice(-(Number(flags.limit) || 20));
      if (sub === 'remove') return removeMemory(projectDir, need(rest[0], 'identifiant de mémoire'));
      break;
    case 'config':
      if (sub === 'get') return cfg;
      if (sub === 'set') return setConfig(projectDir, need(rest[0], 'clé'), need(rest[1], 'valeur'));
      break;
    default:
  }
  throw new OniError(`Commande inconnue : ${pos.join(' ')}. Lancer « help ».`);
}

function status(projectDir, id) {
  const m = mission.loadMission(projectDir, id);
  return { ...mission.summarize(m), goal: m.goal,
    taskList: m.tasks.map((t) => ({ id: t.id, agent: t.agent, status: t.status, attempts: t.attempts, deps: t.deps, ...(t.lastError ? { lastError: t.lastError } : {}) })) };
}

try {
  const out = run(process.argv.slice(2));
  process.stdout.write((out?.help ?? JSON.stringify(out)) + '\n');
} catch (e) {
  if (e instanceof OniError) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ ok: false, error: `Erreur interne : ${e.message}` }) + '\n');
    process.stderr.write(`${e.stack}\n`);
  }
  process.exitCode = 1;
}
