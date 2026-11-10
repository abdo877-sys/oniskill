// Checkpoints : copie de fichiers avant modification, restauration réversible.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { statePath, readJson, writeJsonAtomic, toProjectRel, nowIso, OniError } from './store.mjs';

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function expand(projectDir, rel, cfg, out) {
  const abs = path.join(projectDir, rel);
  let st;
  try { st = fs.lstatSync(abs); } catch { out.push({ path: rel, existed: false }); return; }
  if (st.isSymbolicLink()) { out.push({ path: rel, existed: true, skipped: 'lien symbolique' }); return; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) {
      if (cfg.scanIgnore.includes(name)) continue;
      expand(projectDir, `${rel}/${name}`, cfg, out);
    }
    return;
  }
  if (st.size > cfg.backupMaxFileBytes) { out.push({ path: rel, existed: true, skipped: 'trop volumineux' }); return; }
  out.push({ path: rel, existed: true, size: st.size });
}

function nextId(projectDir) {
  const dir = statePath(projectDir, 'checkpoints');
  fs.mkdirSync(dir, { recursive: true });
  const nums = fs.readdirSync(dir).map((n) => /^cp(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number);
  return `cp${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
}

export function createCheckpoint(projectDir, cfg, paths, label = '') {
  const entries = [];
  for (const p of paths) expand(projectDir, toProjectRel(projectDir, p), cfg, entries);
  if (entries.length > 5000) throw new OniError('Checkpoint trop large (> 5000 fichiers) : ciblez des chemins plus précis.');
  const id = nextId(projectDir);
  const dir = statePath(projectDir, 'checkpoints', id);
  for (const e of entries) {
    if (!e.existed || e.skipped) continue;
    const dest = path.join(dir, 'files', e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(projectDir, e.path), dest);
    e.sha256 = sha256(dest);
  }
  const manifest = { id, label, createdAt: nowIso(), requested: paths, entries };
  writeJsonAtomic(path.join(dir, 'manifest.json'), manifest);
  return manifest;
}

export function listCheckpoints(projectDir) {
  const dir = statePath(projectDir, 'checkpoints');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^cp\d+$/.test(n)).sort().map((n) => {
    const m = readJson(path.join(dir, n, 'manifest.json'));
    return { id: m.id, label: m.label, createdAt: m.createdAt, files: m.entries.length };
  });
}

/**
 * Restaure un checkpoint. L'état actuel est d'abord sauvegardé dans un nouveau checkpoint,
 * de sorte que la restauration elle-même est annulable.
 */
export function restoreCheckpoint(projectDir, cfg, id) {
  const dir = statePath(projectDir, 'checkpoints', id);
  if (!/^cp\d+$/.test(id) || !fs.existsSync(dir)) throw new OniError(`Checkpoint introuvable : ${id}`);
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const undo = createCheckpoint(projectDir, cfg, manifest.entries.map((e) => e.path), `avant restauration de ${id}`);
  const restored = [], removed = [], skipped = [];
  for (const e of manifest.entries) {
    const target = path.join(projectDir, e.path);
    if (e.skipped) { skipped.push(e.path); continue; }
    if (e.existed) {
      const src = path.join(dir, 'files', e.path);
      if (sha256(src) !== e.sha256) throw new OniError(`Checkpoint corrompu : ${e.path}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(src, target);
      restored.push(e.path);
    } else if (fs.existsSync(target) && fs.lstatSync(target).isFile()) {
      fs.unlinkSync(target); // le fichier n'existait pas au moment du checkpoint (copie gardée dans `undo`)
      removed.push(e.path);
    }
  }
  return { id, restored, removed, skipped, undoCheckpoint: undo.id };
}
