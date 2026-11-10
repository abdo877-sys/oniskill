import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'oniskill.mjs');
// Sans cela, un « node --test » lancé par la CLI se croirait sous-processus du lanceur de tests et ne testerait rien.
const ENV = { ...process.env };
delete ENV.NODE_TEST_CONTEXT;

const created = [];
process.on('exit', () => { for (const d of created) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* laissé au système */ } } });

/** Projet temporaire réel sur disque, avec .oniskill initialisé. */
export function tmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniskill-test-'));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  oni(dir, 'init');
  return dir;
}

/** Lance la vraie CLI dans un processus séparé et renvoie { code, out } (out = JSON décodé). */
export function oni(dir, ...args) {
  const input = typeof args.at(-1) === 'object' ? args.pop().stdin : undefined;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', input, env: ENV });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = r.stdout; }
  return { code: r.status, out };
}

/** Lance un hook comme le fait Claude Code : JSON sur stdin, réponse JSON (ou vide) sur stdout. */
export function hook(script, payload, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

export const decision = (h) => h.out?.hookSpecificOutput?.permissionDecision ?? 'allow';
export const plan = (dir, id, tasks) => oni(dir, 'plan', id, { stdin: JSON.stringify(tasks) });
