// Mémoire persistante du projet : un fichier JSONL lisible, recherche par mots-clés.
import fs from 'node:fs';
import { statePath, nowIso, OniError } from './store.mjs';
import { looksLikeSecret } from './guard.mjs';

export const TYPES = ['fait', 'decision', 'lecon', 'preference'];
const file = (projectDir) => statePath(projectDir, 'memory.jsonl');

export function loadMemory(projectDir) {
  let raw;
  try { raw = fs.readFileSync(file(projectDir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* ligne abîmée ignorée, les autres restent utilisables */ }
  }
  return out;
}

function save(projectDir, entries) {
  fs.mkdirSync(statePath(projectDir), { recursive: true });
  const tmp = `${file(projectDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, file(projectDir));
}

export function addMemory(projectDir, cfg, { text, type = 'fait', tags = [], mission = null }) {
  text = String(text ?? '').trim();
  if (!text) throw new OniError('Texte de mémoire vide.');
  if (text.length > 600) throw new OniError('Mémoire limitée à 600 caractères : résumez.');
  if (!TYPES.includes(type)) throw new OniError(`Type inconnu (${TYPES.join(', ')}).`);
  if (looksLikeSecret(text, { loose: true })) throw new OniError('Refusé : ce texte ressemble à un secret (clé, jeton, mot de passe).');
  const entries = loadMemory(projectDir);
  if (entries.some((e) => e.text === text)) return { duplicate: true };
  const n = Math.max(0, ...entries.map((e) => Number(String(e.id).slice(1)) || 0)) + 1;
  const entry = { id: `k${n}`, ts: nowIso(), type, tags: tags.map((t) => t.toLowerCase()), text, ...(mission ? { mission } : {}) };
  entries.push(entry);
  let archived = 0;
  if (entries.length > cfg.memoryMaxEntries) {
    const old = entries.splice(0, entries.length - cfg.memoryMaxEntries);
    archived = old.length;
    fs.appendFileSync(statePath(projectDir, 'memory.archive.jsonl'), old.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  save(projectDir, entries);
  return { entry, archived };
}

const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9_]{3,}/g) ?? [];

export function searchMemory(projectDir, query, limit = 5) {
  const q = new Set(words(query));
  if (!q.size) return [];
  return loadMemory(projectDir)
    .map((e) => {
      const w = new Set([...words(e.text), ...e.tags.flatMap(words)]);
      let score = 0;
      for (const t of q) if (w.has(t)) score++;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.e.ts < b.e.ts ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.e);
}

export function removeMemory(projectDir, id) {
  const entries = loadMemory(projectDir);
  const kept = entries.filter((e) => e.id !== id);
  if (kept.length === entries.length) throw new OniError(`Mémoire introuvable : ${id}`);
  save(projectDir, kept);
  return { removed: id };
}
