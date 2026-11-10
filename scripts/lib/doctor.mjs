// Auto-diagnostic : vérifie sur CETTE machine que les mécanismes dont OniSkill dépend fonctionnent réellement.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic, readJson } from './store.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runDoctor() {
  const checks = [];
  const check = (name, fn) => {
    try { const detail = fn(); checks.push({ name, ok: true, ...(detail ? { detail } : {}) }); }
    catch (e) { checks.push({ name, ok: false, detail: e.message }); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oniskill-doctor-'));

  check('node >= 18', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`Node ${process.versions.node} trop ancien`);
    return `${process.versions.node} sur ${process.platform}/${process.arch}`;
  });
  check('écriture atomique (remplacement de fichier)', () => {
    const f = path.join(tmp, 'a b', 'état.json'); // espace et accent dans le chemin, fréquents sous Windows
    writeJsonAtomic(f, { n: 1 });
    writeJsonAtomic(f, { n: 2 });
    if (readJson(f).n !== 2) throw new Error('relecture incorrecte');
  });
  check('exécution de commande via le shell (utilisée par verify)', () => {
    const ok = spawnSync('node -e "process.exit(0)"', { shell: true, windowsHide: true });
    const ko = spawnSync('node -e "process.exit(3)"', { shell: true, windowsHide: true });
    if (ok.status !== 0 || ko.status !== 3) throw new Error(`codes de sortie inattendus : ${ok.status}, ${ko.status} (${ok.error?.message ?? ''})`);
  });
  check('garde de sécurité (hook PreToolUse)', () => {
    const run = (command) => spawnSync(process.execPath, [path.join(SCRIPTS, 'guard-hook.mjs')],
      { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: tmp }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
    const deny = JSON.parse(run('rm -rf /').stdout).hookSpecificOutput.permissionDecision;
    if (deny !== 'deny') throw new Error(`« rm -rf / » devrait être refusé, obtenu : ${deny}`);
    if (run('npm test').stdout.trim() !== '') throw new Error('« npm test » ne devrait déclencher aucune réponse');
  });
  check('cycle complet du moteur (mission, vérification, preuve)', () => {
    const cli = (...a) => {
      const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'oniskill.mjs'), '--project', tmp, ...a.filter((x) => typeof x === 'string')],
        { encoding: 'utf8', input: a.find((x) => typeof x === 'object')?.stdin });
      const out = JSON.parse(r.stdout);
      if (r.status !== 0) throw new Error(`${a[0]} : ${out.error}`);
      return out;
    };
    cli('init');
    cli('mission', 'create', '--title', 'diagnostic', '--goal', 'auto-test');
    cli('plan', 'm001', { stdin: JSON.stringify([{ id: 't', title: 't', agent: 'testeur', verify: 'node -e "process.exit(0)"' }]) });
    cli('task', 'start', 'm001', 't');
    if (!cli('verify', 'm001', 't').passed) throw new Error('vérification en échec');
    if (cli('task', 'done', 'm001', 't', '--summary', 'ok').missionStatus !== 'terminee') throw new Error('mission non terminée');
  });
  check('git (facultatif)', () => {
    const r = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : 'absent — sans importance, OniSkill ne dépend pas de git';
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* dossier temporaire laissé au système */ }
  return { ok: checks.every((c) => c.ok), checks };
}
