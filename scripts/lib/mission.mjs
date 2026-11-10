// Moteur de mission : état sur disque, validation du plan, dépendances, lots parallèles,
// tentatives limitées, reprise après interruption.
import fs from 'node:fs';
import path from 'node:path';
import { statePath, readJson, writeJsonAtomic, toProjectRel, nowIso, OniError } from './store.mjs';
import { createCheckpoint, restoreCheckpoint } from './checkpoint.mjs';

export const AGENTS = ['architecte', 'developpeur', 'testeur'];
const OPEN = ['brouillon', 'planifiee', 'en_cours', 'bloquee'];

const missionFile = (projectDir, id) => statePath(projectDir, 'missions', id, 'mission.json');

export function listMissions(projectDir) {
  const dir = statePath(projectDir, 'missions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^m\d+$/.test(n)).sort()
    .map((n) => { try { return readJson(missionFile(projectDir, n)); } catch { return null; } })
    .filter(Boolean);
}

export function loadMission(projectDir, id) {
  if (!id) {
    const open = listMissions(projectDir).filter((m) => OPEN.includes(m.status));
    if (open.length === 1) return open[0];
    throw new OniError(open.length ? `Plusieurs missions ouvertes (${open.map((m) => m.id).join(', ')}) : précisez l'identifiant.` : 'Aucune mission ouverte.');
  }
  if (!/^m\d+$/.test(id) || !fs.existsSync(missionFile(projectDir, id))) throw new OniError(`Mission introuvable : ${id}`);
  return readJson(missionFile(projectDir, id));
}

/** Le statut d'une mission active se déduit toujours de ses tâches : une tâche échouée la bloque, même si d'autres avancent. */
function refresh(m) {
  if (!m.tasks.length || ['annulee'].includes(m.status)) return;
  if (m.tasks.every((t) => t.status === 'terminee')) m.status = 'terminee';
  else if (m.tasks.some((t) => t.status === 'echouee')) m.status = 'bloquee';
  else if (m.tasks.some((t) => t.status !== 'en_attente' || t.attempts > 0)) m.status = 'en_cours';
  else m.status = 'planifiee';
}

function save(projectDir, m, event) {
  refresh(m);
  m.updatedAt = nowIso();
  if (event) { m.log.push({ ts: m.updatedAt, ...event }); if (m.log.length > 300) m.log.splice(0, m.log.length - 300); }
  writeJsonAtomic(missionFile(projectDir, m.id), m);
  return m;
}

export function createMission(projectDir, { title, goal }) {
  if (!String(title ?? '').trim() || !String(goal ?? '').trim()) throw new OniError('Titre et objectif obligatoires.');
  const nums = listMissions(projectDir).map((m) => Number(m.id.slice(1)));
  const dir = statePath(projectDir, 'missions');
  fs.mkdirSync(dir, { recursive: true });
  const onDisk = fs.readdirSync(dir).map((n) => /^m(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number);
  const id = `m${String(Math.max(0, ...nums, ...onDisk) + 1).padStart(3, '0')}`;
  const m = { id, title: title.trim(), goal: goal.trim(), status: 'brouillon', createdAt: nowIso(), tasks: [], log: [] };
  return save(projectDir, m, { event: 'mission_creee' });
}

/** Valide un plan. Renvoie la liste des erreurs (vide = plan valide). */
export function validatePlan(projectDir, tasks) {
  const errors = [];
  if (!Array.isArray(tasks) || tasks.length === 0) return ['Le plan doit être une liste non vide de tâches.'];
  if (tasks.length > 60) errors.push('Plan trop long (> 60 tâches) : regroupez.');
  const ids = new Set();
  for (const [i, t] of tasks.entries()) {
    const where = `tâche #${i + 1}${t?.id ? ` (${t.id})` : ''}`;
    if (!t || typeof t !== 'object') { errors.push(`${where} : objet attendu.`); continue; }
    if (typeof t.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(t.id)) errors.push(`${where} : id invalide (lettres, chiffres, - et _).`);
    else if (ids.has(t.id)) errors.push(`${where} : id en double.`);
    else ids.add(t.id);
    if (typeof t.title !== 'string' || !t.title.trim()) errors.push(`${where} : titre manquant.`);
    if (!AGENTS.includes(t.agent)) errors.push(`${where} : agent doit être ${AGENTS.join(', ')}.`);
    if (t.deps !== undefined && (!Array.isArray(t.deps) || t.deps.some((d) => typeof d !== 'string'))) errors.push(`${where} : deps doit être une liste d'ids.`);
    if (t.verify !== undefined && (typeof t.verify !== 'string' || !t.verify.trim())) errors.push(`${where} : verify doit être une commande (texte).`);
    if (t.files !== undefined) {
      if (!Array.isArray(t.files)) errors.push(`${where} : files doit être une liste de chemins.`);
      else for (const f of t.files) { try { toProjectRel(projectDir, f); } catch (e) { errors.push(`${where} : ${e.message}`); } }
    }
  }
  for (const t of tasks) for (const d of t?.deps ?? []) {
    if (!ids.has(d)) errors.push(`tâche ${t.id} : dépendance inconnue « ${d} ».`);
    if (d === t.id) errors.push(`tâche ${t.id} : dépend d'elle-même.`);
  }
  if (errors.length) return errors;
  // Détection de cycle (tri topologique de Kahn).
  const indeg = new Map(tasks.map((t) => [t.id, (t.deps ?? []).length]));
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift(); seen++;
    for (const t of tasks) if ((t.deps ?? []).includes(id)) { indeg.set(t.id, indeg.get(t.id) - 1); if (indeg.get(t.id) === 0) queue.push(t.id); }
  }
  if (seen !== tasks.length) errors.push(`Dépendances circulaires entre : ${[...indeg].filter(([, n]) => n > 0).map(([id]) => id).join(', ')}.`);
  return errors;
}

export function setPlan(projectDir, id, tasks) {
  const m = loadMission(projectDir, id);
  if (!OPEN.includes(m.status)) throw new OniError(`Mission ${m.status} : plan non modifiable.`);
  if (m.tasks.some((t) => t.status === 'en_cours')) throw new OniError('Une tâche est en cours : terminez-la ou lancez `resume` avant de replanifier.');
  const errors = validatePlan(projectDir, tasks);
  if (errors.length) throw new OniError(`Plan invalide :\n- ${errors.join('\n- ')}`);
  const previous = new Map(m.tasks.map((t) => [t.id, t]));
  m.tasks = tasks.map((t) => {
    const old = previous.get(t.id);
    const base = {
      id: t.id, title: t.title.trim(), agent: t.agent, deps: t.deps ?? [],
      files: (t.files ?? []).map((f) => toProjectRel(projectDir, f)),
      ...(t.verify ? { verify: t.verify.trim() } : {}),
      ...(t.details ? { details: String(t.details).slice(0, 1500) } : {}),
    };
    // Une tâche déjà réussie reste acquise si sa définition de vérification n'a pas changé.
    if (old?.status === 'terminee' && old.verify === base.verify) return { ...old, ...base };
    return { ...base, status: 'en_attente', attempts: 0, evidence: [] };
  });
  return save(projectDir, m, { event: 'plan_enregistre', tasks: m.tasks.length });
}

const getTask = (m, taskId) => {
  const t = m.tasks.find((x) => x.id === taskId);
  if (!t) throw new OniError(`Tâche introuvable : ${taskId}`);
  return t;
};
const depsDone = (m, t) => t.deps.every((d) => m.tasks.find((x) => x.id === d)?.status === 'terminee');
const overlap = (a, b) => a.files.some((f) => b.files.some((g) => f === g || f.startsWith(`${g}/`) || g.startsWith(`${f}/`)));
// Une tâche qui écrit sans déclarer ses fichiers ne peut pas être parallélisée sans risque.
const exclusive = (t) => t.agent === 'developpeur' && t.files.length === 0;

/** Tâches prêtes à lancer maintenant, compatibles entre elles et avec celles déjà en cours. */
export function nextBatch(projectDir, cfg, id) {
  const m = loadMission(projectDir, id);
  const running = m.tasks.filter((t) => t.status === 'en_cours');
  const ready = m.tasks.filter((t) => t.status === 'en_attente' && depsDone(m, t));
  const batch = [];
  for (const t of ready) {
    const active = [...running, ...batch];
    if (active.length >= cfg.maxParallel) break;
    if (active.some((a) => overlap(a, t))) continue;
    if (active.length && (exclusive(t) || active.some(exclusive))) continue;
    batch.push(t);
  }
  let note;
  if (!batch.length) {
    if (m.status === 'terminee') note = 'Mission terminée.';
    else if (m.tasks.some((t) => t.status === 'echouee')) note = 'Mission bloquée : une tâche a épuisé ses tentatives. Replanifier ou demander à l’utilisateur.';
    else if (running.length) note = 'Attendre la fin des tâches en cours.';
    else if (!m.tasks.length) note = 'Aucun plan : enregistrer un plan.';
    else note = 'Aucune tâche prête.';
  }
  return {
    mission: m.id, status: m.status, parallel: batch.length > 1, note,
    running: running.map((t) => t.id),
    batch: batch.map((t) => ({ id: t.id, title: t.title, agent: t.agent, files: t.files, verify: t.verify, details: t.details, attempt: t.attempts + 1, lastError: t.lastError })),
  };
}

export function startTask(projectDir, cfg, id, taskId) {
  const m = loadMission(projectDir, id);
  const t = getTask(m, taskId);
  if (t.status !== 'en_attente') throw new OniError(`Tâche ${taskId} : statut ${t.status}, impossible de la démarrer.`);
  if (!depsDone(m, t)) throw new OniError(`Tâche ${taskId} : dépendances non terminées.`);
  if (t.attempts >= cfg.maxAttempts) throw new OniError(`Tâche ${taskId} : tentatives épuisées.`);
  t.attempts += 1;
  t.status = 'en_cours';
  t.startedAt = nowIso();
  delete t.checkpoint;
  if (t.files.length) t.checkpoint = createCheckpoint(projectDir, cfg, t.files, `${m.id}/${t.id} tentative ${t.attempts}`).id;
  save(projectDir, m, { event: 'tache_demarree', task: t.id, attempt: t.attempts });
  return { task: t.id, attempt: t.attempts, maxAttempts: cfg.maxAttempts, checkpoint: t.checkpoint ?? null };
}

/** Ajoute une preuve à une tâche (appelé par verify.mjs). */
export function recordEvidence(projectDir, id, taskId, evidenceRef) {
  const m = loadMission(projectDir, id);
  const t = getTask(m, taskId);
  t.evidence.push(evidenceRef);
  save(projectDir, m, { event: 'preuve', task: t.id, passed: evidenceRef.passed });
}

export function completeTask(projectDir, id, taskId, summary) {
  const m = loadMission(projectDir, id);
  const t = getTask(m, taskId);
  if (t.status !== 'en_cours') throw new OniError(`Tâche ${taskId} : statut ${t.status}, elle doit être en cours.`);
  if (!String(summary ?? '').trim()) throw new OniError('Résumé obligatoire (--summary).');
  if (t.verify) {
    const last = t.evidence.filter((e) => e.attempt === t.attempts).at(-1);
    if (!last) throw new OniError(`Tâche ${taskId} : aucune preuve pour cette tentative. Lancer d'abord « verify ${m.id} ${taskId} ».`);
    if (!last.passed) throw new OniError(`Tâche ${taskId} : la dernière vérification a échoué (${last.file}). Corriger puis relancer verify, ou déclarer l'échec.`);
  }
  t.status = 'terminee';
  t.summary = String(summary).trim().slice(0, 800);
  t.finishedAt = nowIso();
  delete t.lastError;
  save(projectDir, m, { event: 'tache_terminee', task: t.id });
  return { task: t.id, missionStatus: m.status, verified: Boolean(t.verify) };
}

export function failTask(projectDir, cfg, id, taskId, error, { restore = false } = {}) {
  const m = loadMission(projectDir, id);
  const t = getTask(m, taskId);
  if (t.status !== 'en_cours') throw new OniError(`Tâche ${taskId} : statut ${t.status}, elle doit être en cours.`);
  if (!String(error ?? '').trim()) throw new OniError("Description de l'erreur obligatoire (--error).");
  let restored = null;
  if (restore) {
    if (!t.checkpoint) throw new OniError(`Tâche ${taskId} : pas de checkpoint (aucun fichier déclaré).`);
    restored = restoreCheckpoint(projectDir, cfg, t.checkpoint);
  }
  t.lastError = String(error).trim().slice(0, 800);
  const exhausted = t.attempts >= cfg.maxAttempts;
  t.status = exhausted ? 'echouee' : 'en_attente';
  save(projectDir, m, { event: exhausted ? 'tache_echouee' : 'tache_a_reessayer', task: t.id, attempt: t.attempts });
  return { task: t.id, status: t.status, attemptsUsed: t.attempts, attemptsLeft: Math.max(0, cfg.maxAttempts - t.attempts), missionStatus: m.status, restored };
}

/**
 * Rouvre une tâche déjà terminée dont le résultat s'avère mauvais (contrôle du testeur en échec).
 * Les tâches terminées qui en dépendaient repassent aussi en attente : leur résultat n'est plus fiable.
 */
export function reopenTask(projectDir, cfg, id, taskId, error) {
  const m = loadMission(projectDir, id);
  const t = getTask(m, taskId);
  if (t.status !== 'terminee') throw new OniError(`Tâche ${taskId} : statut ${t.status}, seule une tâche terminée se rouvre.`);
  if (!String(error ?? '').trim()) throw new OniError("Raison obligatoire (--error).");
  const dependents = [];
  const visit = (tid) => { for (const x of m.tasks) if (x.deps.includes(tid) && !dependents.includes(x)) { dependents.push(x); visit(x.id); } };
  visit(t.id);
  const busy = dependents.filter((x) => x.status === 'en_cours');
  if (busy.length) throw new OniError(`Terminer ou déclarer en échec d'abord : ${busy.map((x) => x.id).join(', ')}.`);
  const exhausted = t.attempts >= cfg.maxAttempts;
  t.status = exhausted ? 'echouee' : 'en_attente';
  t.lastError = `Rouverte : ${String(error).trim().slice(0, 760)}`;
  const reset = dependents.filter((x) => x.status === 'terminee');
  for (const x of reset) { x.status = 'en_attente'; x.lastError = `À refaire : la tâche ${t.id} a été rouverte.`; }
  save(projectDir, m, { event: 'tache_rouverte', task: t.id, reset: reset.map((x) => x.id) });
  return { task: t.id, status: t.status, attemptsLeft: Math.max(0, cfg.maxAttempts - t.attempts), alsoReset: reset.map((x) => x.id), missionStatus: m.status };
}

/** Reprise : les tâches restées « en cours » après un arrêt sont remises en attente (sans consommer de tentative). */
export function resumeMissions(projectDir) {
  const out = [];
  for (const m of listMissions(projectDir)) {
    if (!OPEN.includes(m.status)) continue;
    const interrupted = m.tasks.filter((t) => t.status === 'en_cours');
    for (const t of interrupted) {
      t.status = 'en_attente';
      t.attempts = Math.max(0, t.attempts - 1);
      t.lastError = `Interrompue le ${nowIso()} : vérifier l'état des fichiers avant de reprendre${t.checkpoint ? ` (checkpoint ${t.checkpoint})` : ''}.`;
    }
    if (interrupted.length) save(projectDir, m, { event: 'reprise', tasks: interrupted.map((t) => t.id) });
    out.push({ ...summarize(m), interrupted: interrupted.map((t) => ({ id: t.id, checkpoint: t.checkpoint ?? null })) });
  }
  return out;
}

export function cancelMission(projectDir, id) {
  const m = loadMission(projectDir, id);
  if (!OPEN.includes(m.status)) throw new OniError(`Mission déjà ${m.status}.`);
  m.status = 'annulee';
  save(projectDir, m, { event: 'mission_annulee' });
  return summarize(m);
}

export function summarize(m) {
  const count = {};
  for (const t of m.tasks) count[t.status] = (count[t.status] ?? 0) + 1;
  return { id: m.id, title: m.title, status: m.status, tasks: m.tasks.length, ...count };
}

export function openMissions(projectDir) {
  return listMissions(projectDir).filter((m) => OPEN.includes(m.status) && m.status !== 'brouillon');
}

/** Rapport Markdown : ce qui a été fait, avec les preuves. */
export function writeReport(projectDir, id) {
  const m = loadMission(projectDir, id);
  const lines = [`# Rapport de mission ${m.id} — ${m.title}`, '', `- Objectif : ${m.goal}`, `- Statut : **${m.status}**`,
    `- Créée : ${m.createdAt} — mise à jour : ${m.updatedAt}`, '', '## Tâches', '',
    '| Tâche | Agent | Statut | Tentatives | Preuve |', '|---|---|---|---|---|'];
  for (const t of m.tasks) {
    const last = t.evidence.at(-1);
    const proof = last ? `${last.passed ? 'RÉUSSITE' : 'ÉCHEC'} — \`${last.command}\` (code ${last.exitCode}) → ${last.file}`
      : (t.verify ? 'aucune vérification exécutée' : 'pas de test automatique (résumé seul)');
    lines.push(`| ${t.id} — ${t.title} | ${t.agent} | ${t.status} | ${t.attempts} | ${proof} |`);
  }
  lines.push('', '## Détails', '');
  for (const t of m.tasks) {
    lines.push(`### ${t.id}`, t.summary ? `Résumé : ${t.summary}` : 'Pas de résumé.');
    if (t.lastError) lines.push(`Dernière erreur : ${t.lastError}`);
    if (t.evidence.length) lines.push(`Vérifications : ${t.evidence.map((e) => `${e.passed ? 'ok' : 'échec'} (tentative ${e.attempt})`).join(', ')}`);
    lines.push('');
  }
  const file = statePath(projectDir, 'missions', m.id, 'report.md');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { file: path.relative(projectDir, file).split(path.sep).join('/'), ...summarize(m) };
}
