import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, oni } from './helpers.mjs';
import { loadConfig, setConfig, DEFAULTS } from '../scripts/lib/config.mjs';
import { validatePlan } from '../scripts/lib/mission.mjs';
import { scanProject } from '../scripts/lib/scanner.mjs';
import { createCheckpoint, restoreCheckpoint } from '../scripts/lib/checkpoint.mjs';
import { addMemory, searchMemory, loadMemory } from '../scripts/lib/memory.mjs';
import { toProjectRel, writeJsonAtomic, readJson } from '../scripts/lib/store.mjs';

test('config : valeurs par défaut, modification validée, clés inconnues refusées', () => {
  const dir = tmpProject();
  assert.equal(loadConfig(dir).maxAttempts, DEFAULTS.maxAttempts);
  assert.equal(setConfig(dir, 'maxAttempts', '2').maxAttempts, 2);
  assert.equal(setConfig(dir, 'guard.sensitiveMode', 'ask').guard.sensitiveMode, 'ask');
  assert.throws(() => setConfig(dir, 'inconnue', '1'), /inconnue/);
  assert.throws(() => setConfig(dir, 'maxAttempts', '"trois"'), /Type invalide/);
  assert.throws(() => setConfig(dir, 'maxAttempts', '0'), /≥ 1/);
  assert.throws(() => setConfig(dir, 'guard.extraAsk', '["("]'), /régulière/);
});

test('config : un fichier corrompu fait retomber sur les valeurs par défaut', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, '.oniskill', 'config.json'), '{ pas du json');
  assert.equal(loadConfig(dir).guard.enabled, true);
});

test('store : chemins hors projet refusés, écriture atomique relisible', () => {
  const dir = tmpProject();
  assert.equal(toProjectRel(dir, 'src/../src/a.js'), 'src/a.js');
  assert.throws(() => toProjectRel(dir, '../ailleurs'), /hors du projet/);
  assert.throws(() => toProjectRel(dir, path.resolve(dir, '..', 'x')), /hors du projet/);
  const f = path.join(dir, 'x', 'data.json');
  writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(readJson(f), { a: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['data.json']);
});

test('planificateur : erreurs de plan détectées', () => {
  const dir = tmpProject();
  const ok = [{ id: 'a', title: 'A', agent: 'architecte' }, { id: 'b', title: 'B', agent: 'developpeur', deps: ['a'], files: ['src/b.js'], verify: 'npm test' }];
  assert.deepEqual(validatePlan(dir, ok), []);
  const errs = (tasks) => validatePlan(dir, tasks).join(' | ');
  assert.match(errs([]), /non vide/);
  assert.match(errs([{ id: 'a', title: 'A', agent: 'architecte' }, { id: 'a', title: 'A', agent: 'architecte' }]), /double/);
  assert.match(errs([{ id: 'a', title: 'A', agent: 'chef' }]), /agent/);
  assert.match(errs([{ id: 'a', title: 'A', agent: 'testeur', deps: ['zz'] }]), /inconnue/);
  assert.match(errs([{ id: 'a', title: 'A', agent: 'testeur', files: ['../../etc/passwd'] }]), /hors du projet/);
  assert.match(errs([{ id: 'a', title: 'A', agent: 'testeur', deps: ['b'] }, { id: 'b', title: 'B', agent: 'testeur', deps: ['c'] }, { id: 'c', title: 'C', agent: 'testeur', deps: ['a'] }]), /circulaires/);
});

test('scanner : détecte les commandes de test réelles, ignore node_modules et le faux script npm', () => {
  const dir = tmpProject({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'src/a.js': '1', 'src/b.ts': '2', 'node_modules/x/index.js': '3', 'Makefile': 'build:\n\techo\ntest:\n\techo ok\n',
  });
  const s = scanProject(dir, loadConfig(dir));
  assert.equal(s.files, 4);
  assert.deepEqual(s.testCommands.map((c) => c.command), ['npm test', 'make test']);
  assert.ok(fs.existsSync(path.join(dir, '.oniskill', 'scan.json')));
  const dir2 = tmpProject({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.deepEqual(scanProject(dir2, loadConfig(dir2)).testCommands, []);
});

test('checkpoint : restauration exacte, suppression des fichiers créés après, et annulation possible', () => {
  const dir = tmpProject({ 'src/a.txt': 'original', 'src/sub/b.txt': 'b' });
  const cfg = loadConfig(dir);
  const cp = createCheckpoint(dir, cfg, ['src', 'nouveau.txt'], 'test');
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'modifié');
  fs.rmSync(path.join(dir, 'src/sub/b.txt'));
  fs.writeFileSync(path.join(dir, 'nouveau.txt'), 'créé après');
  const r = restoreCheckpoint(dir, cfg, cp.id);
  assert.equal(fs.readFileSync(path.join(dir, 'src/a.txt'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(dir, 'src/sub/b.txt'), 'utf8'), 'b');
  assert.equal(fs.existsSync(path.join(dir, 'nouveau.txt')), false);
  // La restauration est réversible : on revient à l'état « modifié ».
  restoreCheckpoint(dir, cfg, r.undoCheckpoint);
  assert.equal(fs.readFileSync(path.join(dir, 'src/a.txt'), 'utf8'), 'modifié');
  assert.equal(fs.readFileSync(path.join(dir, 'nouveau.txt'), 'utf8'), 'créé après');
});

test('checkpoint : fichier trop volumineux signalé et laissé intact, copie corrompue détectée', () => {
  const dir = tmpProject({ 'gros.bin': 'x'.repeat(2000), 'a.txt': 'a' });
  const cfg = { ...loadConfig(dir), backupMaxFileBytes: 1000 };
  const cp = createCheckpoint(dir, cfg, ['gros.bin', 'a.txt']);
  assert.equal(cp.entries.find((e) => e.path === 'gros.bin').skipped, 'trop volumineux');
  fs.writeFileSync(path.join(dir, '.oniskill/checkpoints', cp.id, 'files/a.txt'), 'altéré');
  assert.throws(() => restoreCheckpoint(dir, cfg, cp.id), /corrompu/);
  assert.equal(oni(dir, 'checkpoint', 'restore', 'cp9999').code, 1);
});

test('mémoire : ajout, doublon, recherche sans accents, persistance sur disque, plafond avec archive', () => {
  const dir = tmpProject();
  const cfg = { ...loadConfig(dir), memoryMaxEntries: 3 };
  addMemory(dir, cfg, { text: 'Les tests se lancent avec npm test', type: 'fait', tags: ['Tests'] });
  addMemory(dir, cfg, { text: 'Décision : la base de données est SQLite', type: 'decision' });
  assert.equal(addMemory(dir, cfg, { text: 'Les tests se lancent avec npm test' }).duplicate, true);
  assert.equal(searchMemory(dir, 'decision base donnees')[0].type, 'decision');
  assert.deepEqual(searchMemory(dir, 'kubernetes'), []);
  assert.throws(() => addMemory(dir, cfg, { text: 'x', type: 'rumeur' }), /Type inconnu/);
  addMemory(dir, cfg, { text: 'trois' });
  assert.equal(addMemory(dir, cfg, { text: 'quatre' }).archived, 1);
  assert.equal(loadMemory(dir).length, 3);
  assert.match(fs.readFileSync(path.join(dir, '.oniskill/memory.archive.jsonl'), 'utf8'), /npm test/);
  // Relu par un autre processus (la vraie CLI) : la mémoire survit bien à la session.
  assert.equal(oni(dir, 'memory', 'search', 'sqlite').out[0].type, 'decision');
});

test('mémoire : une ligne abîmée ne fait pas perdre les autres', () => {
  const dir = tmpProject();
  addMemory(dir, loadConfig(dir), { text: 'souvenir valide' });
  fs.appendFileSync(path.join(dir, '.oniskill/memory.jsonl'), '{"id": tronqué\n');
  assert.equal(loadMemory(dir).length, 1);
});
