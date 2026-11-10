// Configuration : valeurs par défaut fusionnées avec .oniskill/config.json.
import { statePath, readJson, writeJsonAtomic, OniError } from './store.mjs';

export const DEFAULTS = Object.freeze({
  maxAttempts: 3, // tentatives par tâche avant blocage de la mission
  maxParallel: 3, // tâches proposées en même temps
  verifyTimeoutSec: 300,
  outputTailChars: 4000, // taille de sortie conservée dans une preuve
  backupMaxFileBytes: 5_000_000,
  memoryMaxEntries: 500,
  scanIgnore: ['node_modules', '.git', '.oniskill', 'dist', 'build', 'out', 'target', '.venv', 'venv',
    '__pycache__', '.next', '.cache', 'vendor', 'bin', 'obj', '.idea', '.vscode', 'coverage'],
  scanMaxFiles: 20000,
  guard: {
    enabled: true,
    sensitiveMode: 'deny', // 'deny' ou 'ask' pour Read/Write/Edit sur un fichier sensible
    extraSensitive: [], // expressions régulières supplémentaires (chemins)
    extraAsk: [], // expressions régulières supplémentaires (commandes à confirmer)
  },
});

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (!(k in base)) continue; // clé inconnue ignorée
    const b = base[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v);
    else if (typeof v === typeof b && Array.isArray(v) === Array.isArray(b)) out[k] = v;
  }
  return out;
}

export function loadConfig(projectDir) {
  let user = {};
  try {
    user = readJson(statePath(projectDir, 'config.json'), {});
  } catch { /* config illisible : on retombe sur les valeurs par défaut, plus sûres */ }
  return merge(DEFAULTS, user);
}

export function setConfig(projectDir, key, rawValue) {
  const parts = key.split('.');
  let ref = DEFAULTS;
  for (const p of parts) {
    if (ref === null || typeof ref !== 'object' || !(p in ref)) throw new OniError(`Clé de configuration inconnue : ${key}`);
    ref = ref[p];
  }
  let value;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  if (typeof value !== typeof ref || Array.isArray(value) !== Array.isArray(ref)) {
    throw new OniError(`Type invalide pour ${key} : attendu ${Array.isArray(ref) ? 'liste' : typeof ref}`);
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 1)) throw new OniError(`${key} doit être un nombre ≥ 1`);
  if (key === 'guard.sensitiveMode' && !['deny', 'ask'].includes(value)) throw new OniError('guard.sensitiveMode : deny ou ask');
  for (const k of ['guard.extraSensitive', 'guard.extraAsk']) {
    if (key === k) for (const r of value) { try { new RegExp(r); } catch { throw new OniError(`Expression régulière invalide : ${r}`); } }
  }
  const file = statePath(projectDir, 'config.json');
  const user = readJson(file, {});
  let o = user;
  parts.slice(0, -1).forEach((p) => { o = o[p] = (o[p] && typeof o[p] === 'object') ? o[p] : {}; });
  o[parts.at(-1)] = value;
  writeJsonAtomic(file, user);
  return loadConfig(projectDir);
}
