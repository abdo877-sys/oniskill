// Accès disque : localisation du projet, lecture/écriture JSON atomique.
import fs from 'node:fs';
import path from 'node:path';

export const STATE_DIR = '.oniskill';

export class OniError extends Error {}

/** Racine du projet : dossier contenant déjà .oniskill en remontant, sinon le dossier de départ. */
export function findProjectDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, STATE_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export const statePath = (projectDir, ...parts) => path.join(projectDir, STATE_DIR, ...parts);

export function readJson(file, fallback = undefined) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new OniError(`JSON invalide dans ${file} : ${e.message}`);
  }
}

/** Écrit dans un fichier temporaire puis renomme : un arrêt brutal ne laisse jamais un fichier à moitié écrit. */
export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e; // Windows : antivirus ou indexeur peuvent verrouiller brièvement la cible.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* rien */ }
  throw lastErr;
}

/** Chemin relatif au projet, avec des « / ». Refuse tout chemin qui sort du projet. */
export function toProjectRel(projectDir, p) {
  const abs = path.resolve(projectDir, p);
  const rel = path.relative(projectDir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new OniError(`Chemin hors du projet ou vide : ${p}`);
  }
  return rel.split(path.sep).join('/');
}

export const nowIso = () => new Date().toISOString();
