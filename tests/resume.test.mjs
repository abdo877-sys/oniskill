// Tests de reprise : arrêt brutal, nouvelle session, fichiers d'état abîmés.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpProject, oni, hook, plan, ROOT } from './helpers.mjs';

const TASKS = [
  { id: 'a', title: 'A', agent: 'developpeur', files: ['a.txt'] },
  { id: 'b', title: 'B', agent: 'developpeur', files: ['b.txt'], deps: ['a'], verify: 'node -e "setTimeout(()=>{},4000)"' },
];
function started() {
  const dir = tmpProject({ 'a.txt': 'avant' });
  oni(dir, 'mission', 'create', '--title', 'Reprise', '--goal', 'G');
  plan(dir, 'm001', TASKS);
  oni(dir, 'task', 'start', 'm001', 'a');
  return dir;
}

test('session coupée pendant une tâche : resume la remet en attente sans consommer de tentative', () => {
  const dir = started();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'à moitié modifié'); // puis la session s'arrête ici
  const r = oni(dir, 'resume').out;
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].interrupted, [{ id: 'a', checkpoint: 'cp0001' }]);
  const next = oni(dir, 'next', 'm001').out.batch[0];
  assert.deepEqual([next.id, next.attempt], ['a', 1]);
  assert.match(next.lastError, /Interrompue.*cp0001/);
  // Le checkpoint pris au démarrage permet de retrouver l'état d'avant l'interruption.
  oni(dir, 'checkpoint', 'restore', 'cp0001');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'avant');
  // Un second resume ne change plus rien.
  assert.deepEqual(oni(dir, 'resume').out[0].interrupted, []);
});

test('hook SessionStart : signale la mission ouverte, se tait sinon', () => {
  const dir = started();
  const h = hook('session-hook.mjs', { hook_event_name: 'SessionStart', source: 'startup', cwd: dir });
  assert.equal(h.out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(h.out.hookSpecificOutput.additionalContext, /m001 « Reprise ».*0\/2.*1 interrompue/);
  // Le hook informe mais ne modifie pas l'état.
  assert.equal(oni(dir, 'status', 'm001').out.taskList[0].status, 'en_cours');
  // Depuis un sous-dossier du projet, la mission est retrouvée.
  fs.mkdirSync(path.join(dir, 'src/deep'), { recursive: true });
  assert.ok(hook('session-hook.mjs', { cwd: path.join(dir, 'src/deep') }).out);
  oni(dir, 'mission', 'cancel', 'm001');
  assert.equal(hook('session-hook.mjs', { cwd: dir }).out, null);
  const empty = tmpProject();
  oni(empty, 'mission', 'create', '--title', 'Brouillon', '--goal', 'G');
  assert.equal(hook('session-hook.mjs', { cwd: empty }).out, null);
  assert.equal(hook('session-hook.mjs', { cwd: fs.mkdtempSync(path.join(path.dirname(empty), 'vide-')) }).out, null);
});

test('processus tué en pleine vérification : état cohérent, reprise possible', async () => {
  const dir = started();
  oni(dir, 'task', 'done', 'm001', 'a', '--summary', 'ok');
  oni(dir, 'task', 'start', 'm001', 'b');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/oniskill.mjs'), 'verify', 'm001', 'b'], { cwd: dir, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));
  // Aucune preuve n'a été fabriquée et l'état reste lisible.
  const s = oni(dir, 'status', 'm001').out;
  assert.deepEqual(s.taskList.map((t) => t.status), ['terminee', 'en_cours']);
  assert.equal(fs.existsSync(path.join(dir, '.oniskill/missions/m001/evidence')), false);
  assert.match(oni(dir, 'task', 'done', 'm001', 'b', '--summary', 'x').out.error, /aucune preuve/);
  assert.deepEqual(oni(dir, 'resume').out[0].interrupted.map((t) => t.id), ['b']);
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['b']);
});

test('écriture interrompue : un fichier temporaire tronqué ne corrompt pas la mission', () => {
  const dir = started();
  const mdir = path.join(dir, '.oniskill/missions/m001');
  fs.writeFileSync(path.join(mdir, 'mission.json.99999.tmp'), '{"id":"m001","tas'); // reste d'un arrêt en cours d'écriture
  assert.equal(oni(dir, 'status', 'm001').out.status, 'en_cours');
  assert.equal(oni(dir, 'task', 'done', 'm001', 'a', '--summary', 'ok').code, 0);
});

test('mission.json illisible : erreur claire, les autres missions restent utilisables', () => {
  const dir = started();
  oni(dir, 'mission', 'create', '--title', 'Deux', '--goal', 'G');
  fs.writeFileSync(path.join(dir, '.oniskill/missions/m001/mission.json'), '{ abîmé');
  const r = oni(dir, 'status', 'm001');
  assert.equal(r.code, 1);
  assert.match(r.out.error, /JSON invalide/);
  assert.deepEqual(oni(dir, 'mission', 'list').out.map((m) => m.id), ['m002']);
  assert.equal(oni(dir, 'mission', 'create', '--title', 'Trois', '--goal', 'G').out.id, 'm003'); // pas de réutilisation de m001
});
