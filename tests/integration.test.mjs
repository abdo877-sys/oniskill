// Tests d'intégration : la vraie CLI, dans de vrais processus, sur de vrais fichiers et de vrais tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, oni, plan } from './helpers.mjs';

const BUGGY = 'export const add = (a, b) => a - b;\n';
const FIXED = 'export const add = (a, b) => a + b;\n';
const TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './calc.mjs';\ntest('add', () => assert.equal(add(2, 3), 5));\n";
const calcProject = () => tmpProject({ 'calc.mjs': BUGGY, 'calc.test.mjs': TEST, 'package.json': '{"type":"module","scripts":{"test":"node --test"}}' });

test('mission complète : échec réel, preuve d’échec, correction, preuve de réussite, rapport', () => {
  const dir = calcProject();
  assert.equal(oni(dir, 'scan').out.testCommands[0].command, 'npm test');
  const id = oni(dir, 'mission', 'create', '--title', 'Corriger add', '--goal', 'add(2,3) doit valoir 5').out.id;
  assert.equal(plan(dir, id, [
    { id: 'fix', title: 'Corriger calc', agent: 'developpeur', files: ['calc.mjs'], verify: 'node --test' },
    { id: 'controle', title: 'Contrôle final', agent: 'testeur', deps: ['fix'], verify: 'node --test' },
  ]).out.status, 'planifiee');

  assert.deepEqual(oni(dir, 'next', id).out.batch.map((t) => t.id), ['fix']);
  assert.equal(oni(dir, 'task', 'start', id, 'fix').out.checkpoint, 'cp0001');

  // Tentative 1 : le code est encore faux. La vérification échoue vraiment et le moteur refuse « done ».
  const v1 = oni(dir, 'verify', id, 'fix').out;
  assert.equal(v1.passed, false);
  assert.notEqual(v1.exitCode, 0);
  const refused = oni(dir, 'task', 'done', id, 'fix', '--summary', 'terminé (faux)');
  assert.equal(refused.code, 1);
  assert.match(refused.out.error, /vérification a échoué/);
  const f = oni(dir, 'task', 'fail', id, 'fix', '--error', 'add soustrait au lieu d’additionner').out;
  assert.deepEqual([f.status, f.attemptsLeft], ['en_attente', 2]);

  // Tentative 2 : la tâche revient avec l'erreur précédente ; une preuve d'une tentative passée ne compte pas.
  const again = oni(dir, 'next', id).out.batch[0];
  assert.equal(again.attempt, 2);
  assert.match(again.lastError, /soustrait/);
  oni(dir, 'task', 'start', id, 'fix');
  assert.match(oni(dir, 'task', 'done', id, 'fix', '--summary', 'x').out.error, /aucune preuve pour cette tentative/);
  fs.writeFileSync(path.join(dir, 'calc.mjs'), FIXED);
  assert.equal(oni(dir, 'verify', id, 'fix').out.passed, true);
  assert.equal(oni(dir, 'task', 'done', id, 'fix', '--summary', 'opérateur corrigé').out.missionStatus, 'en_cours');

  oni(dir, 'task', 'start', id, 'controle');
  oni(dir, 'verify', id, 'controle');
  assert.equal(oni(dir, 'task', 'done', id, 'controle', '--summary', 'suite verte').out.missionStatus, 'terminee');

  // Preuves sur disque : une d'échec et une de réussite pour « fix », avec la sortie réelle du test.
  const ev = (n) => JSON.parse(fs.readFileSync(path.join(dir, '.oniskill/missions', id, 'evidence', n), 'utf8'));
  assert.equal(ev('fix.1.json').passed, false);
  assert.match(ev('fix.1.json').stdoutTail + ev('fix.1.json').stderrTail, /-1|5|fail/);
  assert.deepEqual([ev('fix.2.json').passed, ev('fix.2.json').exitCode, ev('fix.2.json').attempt], [true, 0, 2]);
  const report = fs.readFileSync(path.join(dir, oni(dir, 'report', id).out.file), 'utf8');
  assert.match(report, /terminee/);
  assert.match(report, /RÉUSSITE — `node --test` \(code 0\)/);
  assert.match(report, /échec \(tentative 1\), ok \(tentative 2\)/);
});

test('tentatives limitées : blocage après épuisement, restauration du checkpoint, replanification', () => {
  const dir = calcProject();
  oni(dir, 'config', 'set', 'maxAttempts', '2');
  oni(dir, 'mission', 'create', '--title', 'T', '--goal', 'G');
  plan(dir, 'm001', [{ id: 'fix', title: 'Corriger', agent: 'developpeur', files: ['calc.mjs'], verify: 'node --test' }, { id: 'doc', title: 'Doc', agent: 'developpeur', files: ['README.md'] }]);
  oni(dir, 'task', 'start', 'm001', 'fix');
  fs.writeFileSync(path.join(dir, 'calc.mjs'), 'CASSÉ');
  const f1 = oni(dir, 'task', 'fail', 'm001', 'fix', '--error', 'essai raté', '--restore').out;
  assert.equal(fs.readFileSync(path.join(dir, 'calc.mjs'), 'utf8'), BUGGY);
  assert.equal(f1.restored.restored[0], 'calc.mjs');
  oni(dir, 'task', 'start', 'm001', 'fix');
  const f2 = oni(dir, 'task', 'fail', 'm001', 'fix', '--error', 'encore raté').out;
  assert.deepEqual([f2.status, f2.missionStatus, f2.attemptsLeft], ['echouee', 'bloquee', 0]);
  assert.equal(oni(dir, 'task', 'start', 'm001', 'fix').code, 1);
  // Les tâches indépendantes restent proposées ; quand il n'y en a plus, le moteur dit pourquoi.
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['doc']);
  oni(dir, 'task', 'start', 'm001', 'doc');
  oni(dir, 'task', 'done', 'm001', 'doc', '--summary', 'README écrit');
  const blocked = oni(dir, 'next', 'm001').out;
  assert.deepEqual(blocked.batch, []);
  assert.match(blocked.note, /bloquée/);
  assert.equal(oni(dir, 'status', 'm001').out.status, 'bloquee');
  // Replanifier : la tâche réussie reste acquise, la tâche échouée repart de zéro.
  const re = plan(dir, 'm001', [{ id: 'fix', title: 'Autre approche', agent: 'developpeur', files: ['calc.mjs'], verify: 'node --test' }, { id: 'doc', title: 'Doc', agent: 'developpeur', files: ['README.md'] }]).out;
  assert.deepEqual([re.status, re.terminee, re.en_attente], ['en_cours', 1, 1]); // débloquée, et déjà entamée
});

test('parallélisme et dépendances : lots sans conflit de fichiers', () => {
  const dir = tmpProject();
  oni(dir, 'mission', 'create', '--title', 'T', '--goal', 'G');
  plan(dir, 'm001', [
    { id: 'a', title: 'A', agent: 'developpeur', files: ['src/a'] },
    { id: 'b', title: 'B', agent: 'developpeur', files: ['src/b.js'] },
    { id: 'c', title: 'C', agent: 'developpeur', files: ['src/a/x.js'] }, // conflit avec a (même dossier)
    { id: 'd', title: 'D', agent: 'developpeur' }, // pas de fichiers déclarés : jamais en parallèle
    { id: 'e', title: 'E', agent: 'architecte' }, // lecture seule : parallélisable
    { id: 'z', title: 'Z', agent: 'testeur', deps: ['a', 'b'] },
  ]);
  const n1 = oni(dir, 'next', 'm001').out;
  assert.deepEqual([n1.batch.map((t) => t.id), n1.parallel], [['a', 'b', 'e'], true]);
  oni(dir, 'config', 'set', 'maxParallel', '2');
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['a', 'b']);
  oni(dir, 'task', 'start', 'm001', 'a');
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['b']);
  assert.match(oni(dir, 'task', 'start', 'm001', 'z').out.error, /dépendances/);
  oni(dir, 'task', 'start', 'm001', 'b');
  assert.match(oni(dir, 'next', 'm001').out.note, /Attendre/);
  oni(dir, 'task', 'done', 'm001', 'a', '--summary', 'ok');
  // a terminé : c (qui était en conflit avec a) devient possible ; z attend encore b.
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['c']);
  oni(dir, 'task', 'done', 'm001', 'b', '--summary', 'ok');
  oni(dir, 'config', 'set', 'maxParallel', '5');
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => t.id), ['c', 'e', 'z']);
});

test('garde-fous du moteur : transitions interdites, plan invalide, délai dépassé', () => {
  const dir = tmpProject();
  assert.match(oni(dir, 'next').out.error, /Aucune mission/);
  oni(dir, 'mission', 'create', '--title', 'T', '--goal', 'G');
  assert.match(plan(dir, 'm001', [{ id: 'a', title: 'A', agent: 'testeur', deps: ['a'] }]).out.error, /elle-même/);
  assert.match(oni(dir, 'plan', 'm001', { stdin: 'pas du json' }).out.error, /JSON invalide/);
  plan(dir, 'm001', [{ id: 'lent', title: 'L', agent: 'testeur', verify: 'node -e "setTimeout(()=>{},8000)"' }, { id: 'libre', title: 'Sans test', agent: 'developpeur' }]);
  assert.match(oni(dir, 'task', 'done', 'm001', 'lent', '--summary', 'x').out.error, /doit être en cours/);
  assert.match(oni(dir, 'verify', 'm001', 'lent').out.error, /doit être en cours/);
  oni(dir, 'task', 'start', 'm001', 'lent');
  assert.match(plan(dir, 'm001', [{ id: 'x', title: 'X', agent: 'testeur' }]).out.error, /en cours/);
  assert.match(oni(dir, 'task', 'start', 'm001', 'lent').out.error, /impossible/);
  oni(dir, 'config', 'set', 'verifyTimeoutSec', '1');
  const v = oni(dir, 'verify', 'm001', 'lent').out;
  assert.deepEqual([v.passed, v.timedOut], [false, true]);
  // Tâche sans test automatique : un résumé est exigé, et le rapport dit clairement qu'il n'y a pas de preuve.
  oni(dir, 'task', 'start', 'm001', 'libre');
  assert.equal(oni(dir, 'task', 'done', 'm001', 'libre').code, 1);
  assert.equal(oni(dir, 'task', 'done', 'm001', 'libre', '--summary', 'note rédigée').out.verified, false);
  assert.match(fs.readFileSync(path.join(dir, oni(dir, 'report', 'm001').out.file), 'utf8'), /pas de test automatique/);
  assert.equal(oni(dir, 'mission', 'cancel', 'm001').out.status, 'annulee');
  assert.equal(oni(dir, 'commande-inconnue').code, 1);
});

test('contrôle en échec : la tâche fautive est rouverte, ses dépendantes sont à refaire', () => {
  const dir = tmpProject();
  oni(dir, 'config', 'set', 'maxAttempts', '2');
  oni(dir, 'mission', 'create', '--title', 'T', '--goal', 'G');
  plan(dir, 'm001', [
    { id: 'doc', title: 'Rédiger', agent: 'developpeur', files: ['note.md'] },
    { id: 'index', title: 'Indexer', agent: 'developpeur', files: ['index.md'], deps: ['doc'] },
    { id: 'controle', title: 'Contrôler', agent: 'testeur', deps: ['index'], verify: 'node -e "require(\'fs\').readFileSync(\'note.md\')"' },
  ]);
  for (const t of ['doc', 'index']) { oni(dir, 'task', 'start', 'm001', t); oni(dir, 'task', 'done', 'm001', t, '--summary', 'annoncé fait'); }
  oni(dir, 'task', 'start', 'm001', 'controle');
  assert.equal(oni(dir, 'verify', 'm001', 'controle').out.passed, false); // note.md n'existe pas : le contrôle le voit
  assert.match(oni(dir, 'task', 'reopen', 'm001', 'doc', '--error', 'x').out.error, /controle/);
  oni(dir, 'task', 'fail', 'm001', 'controle', '--error', 'note.md absent');
  const r = oni(dir, 'task', 'reopen', 'm001', 'doc', '--error', 'note.md absent').out;
  assert.deepEqual([r.status, r.alsoReset, r.attemptsLeft], ['en_attente', ['index'], 1]);
  assert.deepEqual(oni(dir, 'next', 'm001').out.batch.map((t) => [t.id, t.attempt]), [['doc', 2]]);
  assert.match(oni(dir, 'task', 'reopen', 'm001', 'index', '--error', 'x').out.error, /seule une tâche terminée/);
  // Refait correctement, tout repasse ; une nouvelle réouverture épuiserait les tentatives et bloquerait la mission.
  oni(dir, 'task', 'start', 'm001', 'doc');
  fs.writeFileSync(path.join(dir, 'note.md'), 'contenu');
  oni(dir, 'task', 'done', 'm001', 'doc', '--summary', 'écrit');
  assert.deepEqual(oni(dir, 'task', 'reopen', 'm001', 'doc', '--error', 'encore faux').out.missionStatus, 'bloquee');
});
