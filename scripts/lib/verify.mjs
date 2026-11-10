// Vérification : exécute réellement la commande et enregistre une preuve horodatée.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { statePath, writeJsonAtomic, nowIso, OniError } from './store.mjs';
import { loadMission, recordEvidence } from './mission.mjs';
import { classifyCommand } from './guard.mjs';

const tail = (s, n) => { s = String(s ?? ''); return s.length > n ? `…${s.slice(-n)}` : s; };

export function runVerify(projectDir, cfg, id, taskId) {
  const m = loadMission(projectDir, id);
  const t = m.tasks.find((x) => x.id === taskId);
  if (!t) throw new OniError(`Tâche introuvable : ${taskId}`);
  if (!t.verify) throw new OniError(`Tâche ${taskId} : aucune commande de vérification dans le plan.`);
  if (t.status !== 'en_cours') throw new OniError(`Tâche ${taskId} : statut ${t.status}, elle doit être en cours.`);
  // La commande vient du plan : elle passe par la même garde que les commandes shell.
  if (cfg.guard.enabled) {
    const g = classifyCommand(t.verify, cfg);
    if (g.decision !== 'allow') throw new OniError(`Commande de vérification refusée par la garde (${g.reason}) Corriger le plan.`);
  }
  const startedAt = nowIso();
  const t0 = Date.now();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // sinon un « node --test » imbriqué ne testerait rien et renverrait un faux succès
  const r = spawnSync(t.verify, { env, cwd: projectDir, shell: true, encoding: 'utf8', timeout: cfg.verifyTimeoutSec * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const evidence = {
    mission: m.id, task: t.id, attempt: t.attempts, command: t.verify, startedAt, durationMs: Date.now() - t0,
    exitCode: r.status, signal: r.signal ?? null, timedOut,
    spawnError: r.error && !timedOut ? r.error.message : null,
    passed: r.status === 0 && !r.error,
    stdoutTail: tail(r.stdout, cfg.outputTailChars), stderrTail: tail(r.stderr, cfg.outputTailChars),
  };
  const dir = statePath(projectDir, 'missions', m.id, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  const n = fs.readdirSync(dir).filter((f) => f.startsWith(`${t.id}.`)).length + 1;
  const file = path.join(dir, `${t.id}.${n}.json`);
  writeJsonAtomic(file, evidence);
  const rel = path.relative(projectDir, file).split(path.sep).join('/');
  recordEvidence(projectDir, m.id, t.id, { file: rel, attempt: t.attempts, passed: evidence.passed, exitCode: evidence.exitCode, command: t.verify, at: startedAt });
  // Sortie courte pour économiser le contexte ; le détail complet est dans le fichier de preuve.
  return { task: t.id, attempt: t.attempts, passed: evidence.passed, exitCode: evidence.exitCode, timedOut, durationMs: evidence.durationMs, evidence: rel,
    output: evidence.passed ? tail(r.stdout, 400) : tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim(), 1500) };
}
