// Règles de sécurité : fonctions pures, sans accès disque, donc testables une à une.
// C'est un filet de sécurité par analyse de texte, PAS un bac à sable : une commande
// suffisamment déguisée peut passer. Les permissions natives de Claude Code restent actives.

const SAFE_ENV = /^\.env\.(example|sample|template|dist|defaults)$/i;
const SENSITIVE_BASENAME = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials)$/i,
  /^_netrc$/i,
  /^\.?credentials(\.json)?$/i,
  /^secrets?(\.[\w.-]+)?$/i,
  /^service-account.*\.json$/i,
];
const SENSITIVE_DIR = /(^|\/)\.(ssh|aws|gnupg|azure|kube)(\/|$)|(^|\/)\.docker\/config\.json$/i;
const PROTECTED_STATE = /(^|[\\/])\.oniskill[\\/](missions|checkpoints|config\.json)([\\/]|$)/i;

const SECRET_TOKENS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./,
];
const CREDENTIAL_ASSIGNMENT = /\b(pass(word|wd)?|secret|token|api[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/i;

const NETWORK = /(?<![\w.\/\\-])(curl|wget|nc|ncat|netcat|scp|sftp|ftp|rsync|ssh|telnet|invoke-webrequest|invoke-restmethod|iwr|irm|start-bitstransfer|bitsadmin|certutil)(?![\w-])|net\.webclient/i;
const ENV_DUMP = /(?<![\w.\/\\-])(printenv|env)\s*(\||>)|(get-childitem|gci|dir|ls)\s+env:/i;

const DENY = [
  [/\bmkfs(\.\w+)?\b/i, 'formatage de disque'],
  [/\bdd\b[^|;&]*\bof=\/dev\//i, 'écriture directe sur un périphérique'],
  [/>\s*\/dev\/(sd|nvme|hd|disk)/i, 'écriture directe sur un disque'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/, 'fork bomb'],
  [/(?<![\w-])format(\.com)?\s+[a-z]:/i, 'formatage de lecteur'],
  [/\b(diskpart|bcdedit)\b/i, 'outil système destructeur'],
  [/\b(format-volume|clear-disk|remove-partition)\b/i, 'destruction de volume'],
  [/\bcipher\s+\/w/i, 'effacement sécurisé de disque'],
  [/\bvssadmin\s+delete\b/i, 'suppression des clichés instantanés'],
  [/\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)/i, 'suppression dans le registre système'],
];

const ASK = [
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard efface les modifications locales'],
  [/\bgit\s+clean\s+-\w*f/i, 'git clean supprime les fichiers non suivis'],
  [/\bgit\s+push\b.*(--force|--force-with-lease|--delete|--mirror|\s-f\b)/i, 'git push destructeur'],
  [/\bgit\s+checkout\s+(--\s+)?\.(\s|$)/i, 'git checkout . efface les modifications locales'],
  [/\bgit\s+restore\s+(?!--staged)/i, 'git restore efface des modifications locales'],
  [/\bgit\s+branch\s+-D\b/, 'suppression forcée de branche'],
  [/\bgit\s+stash\s+(drop|clear)\b/i, 'suppression de stash'],
  [/\bgit\s+filter-(branch|repo)\b/i, "réécriture de l'historique git"],
  [/\b(drop\s+(database|table|schema)|truncate\s+table)\b/i, 'SQL destructeur'],
  [/\bdelete\s+from\s+[\w."`\[\]]+\s*(;|"|'|$)/i, 'DELETE sans WHERE'],
  [/(?<![\w.\/\\-])(shutdown|reboot|halt|poweroff|stop-computer|restart-computer)(?![\w-])/i, 'arrêt ou redémarrage de la machine'],
  [/\bch(mod|own)\s+(-\w*R|--recursive)/, 'changement récursif de droits'],
  [/\b(icacls|takeown)\b/i, 'changement de droits Windows'],
  [/(?<![\w.\/\\-])sudo\s/, 'élévation de privilèges'],
  [/\bset-executionpolicy\b/i, "changement de politique d'exécution"],
  [/\b(npm|pnpm|yarn|cargo)\s+publish\b|\btwine\s+upload\b/i, 'publication de paquet'],
  [/\bdocker\s+(system|volume|image|container)\s+prune\b|\bdocker\s+volume\s+rm\b/i, 'suppression Docker'],
  [/\bkubectl\s+delete\b/i, 'suppression Kubernetes'],
  [/\bterraform\s+(destroy|apply)\b/i, "modification d'infrastructure"],
  [/\bfind\b.*\s-delete\b/i, 'find -delete'],
  [/(\bxargs|-exec)\s+(sudo\s+)?rm\b/i, 'suppression en masse'],
  [/\btruncate\s+-s/i, 'troncature de fichier'],
  [/\brobocopy\b.*\/(mir|purge)\b/i, 'robocopy en miroir supprime des fichiers'],
  [/\brsync\b.*--delete/i, 'rsync --delete supprime des fichiers'],
  [/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell|iex|invoke-expression|python\d?|node)\b/i, 'exécution de code téléchargé'],
  [/\b(iex|invoke-expression)\b.*(downloadstring|iwr|irm|invoke-webrequest)/i, 'exécution de code téléchargé'],
];

const ROOT_TARGET = new RegExp('^(' + [
  '\\/\\*?', '~([\\\\/]\\*?)?', '\\$HOME([\\\\/]\\*?)?', '\\$\\{HOME\\}([\\\\/]\\*?)?',
  '%USERPROFILE%([\\\\/]\\*?)?', '\\$env:USERPROFILE([\\\\/]\\*?)?', '[a-z]:([\\\\/]\\*?)?',
  '\\.\\.([\\\\/].*)?',
  '\\/(etc|usr|bin|sbin|var|home|boot|lib|lib64|sys|proc|dev|opt|root|Users|Windows)([\\\\/]\\*?)?',
  '[a-z]:[\\\\/](Windows|Users|Program Files( \\(x86\\))?)([\\\\/]\\*?)?',
].join('|') + ')$', 'i');

const unquote = (s) => s.replace(/^["']+|["']+$/g, '');

export function looksLikeSecret(text, { loose = false } = {}) {
  const s = String(text ?? '');
  return SECRET_TOKENS.some((r) => r.test(s)) || (loose && CREDENTIAL_ASSIGNMENT.test(s));
}

function safeRegexes(list) {
  const out = [];
  for (const src of list ?? []) { try { out.push(new RegExp(src, 'i')); } catch { /* regex invalide ignorée */ } }
  return out;
}

export function isSensitivePath(p, cfg = {}) {
  const norm = unquote(String(p ?? '')).replace(/\\/g, '/');
  if (!norm) return false;
  if (safeRegexes(cfg.guard?.extraSensitive).some((r) => r.test(norm))) return true;
  const base = norm.split('/').filter(Boolean).at(-1) ?? '';
  if (SAFE_ENV.test(base) || /\.pub$/i.test(base)) return false;
  return SENSITIVE_DIR.test(norm) || SENSITIVE_BASENAME.some((r) => r.test(base));
}

export const isProtectedState = (p) => PROTECTED_STATE.test(String(p ?? ''));

/** Analyse les suppressions (rm, del, rd, Remove-Item). Renvoie 'deny', 'ask' ou null. */
function classifyDeletion(cmd) {
  let worst = null;
  for (const seg of cmd.split(/\n|;|&&|\|\||\|/)) {
    const t = seg.trim().replace(/^((sudo|command|exec)\s+|\w+=\S+\s+)+/i, '');
    const m = /^(rm|del|erase|rd|rmdir|remove-item|ri)(?:\.exe)?\s+(.*)$/i.exec(t);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const tokens = m[2].split(/\s+/).filter(Boolean);
    const unixRec = tokens.some((x) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(x) || x === '--recursive');
    const winRec = tokens.some((x) => /^\/s$/i.test(x));
    const psRec = tokens.some((x) => /^-r(ec(urse)?)?$/i.test(x));
    const recursive = unixRec || psRec || (['del', 'erase', 'rd', 'rmdir'].includes(name) && winRec);
    const targets = tokens.filter((x) => !x.startsWith('-') && !(/^\/[a-z]$/i.test(x) && name !== 'rm')).map(unquote);
    if (recursive && (targets.some((x) => ROOT_TARGET.test(x)) || tokens.includes('--no-preserve-root'))) return 'deny';
    if (recursive || targets.some((x) => x.includes('*'))) worst = 'ask';
  }
  return worst;
}

/** @returns {{decision:'allow'|'ask'|'deny', reason?:string}} */
export function classifyCommand(command, cfg = {}) {
  const cmd = String(command ?? '');
  if (!cmd.trim()) return { decision: 'allow' };
  for (const [re, why] of DENY) if (re.test(cmd)) return { decision: 'deny', reason: `Commande interdite : ${why}.` };
  const del = classifyDeletion(cmd);
  if (del === 'deny') return { decision: 'deny', reason: 'Suppression récursive visant une racine, un dossier système ou un dossier hors du projet.' };

  const tokens = cmd.split(/[\s"'`=<>|;&(),@]+/).filter(Boolean);
  const sensitive = tokens.find((t) => isSensitivePath(t, cfg));
  const network = NETWORK.test(cmd);
  if (network && sensitive) return { decision: 'deny', reason: `Envoi réseau impliquant un fichier sensible (${sensitive}).` };
  if (network && ENV_DUMP.test(cmd)) return { decision: 'deny', reason: "Envoi réseau des variables d'environnement." };
  if (network && looksLikeSecret(cmd)) return { decision: 'deny', reason: 'Envoi réseau contenant un secret en clair.' };

  if (del === 'ask') return { decision: 'ask', reason: 'Suppression récursive ou par joker : confirmation requise.' };
  for (const [re, why] of ASK) if (re.test(cmd)) return { decision: 'ask', reason: `Opération à confirmer : ${why}.` };
  for (const re of safeRegexes(cfg.guard?.extraAsk)) if (re.test(cmd)) return { decision: 'ask', reason: `Règle personnalisée : ${re.source}` };
  if (sensitive) return { decision: 'ask', reason: `La commande mentionne un fichier sensible (${sensitive}).` };
  if (/\.oniskill[\\/](missions|checkpoints|config\.json)/i.test(cmd) && !/oniskill\.mjs/i.test(cmd)) {
    return { decision: 'ask', reason: "Accès direct à l'état interne d'OniSkill (passer par la CLI)." };
  }
  if (/oniskill\.mjs.*\bconfig\s+set\s+guard\b/i.test(cmd)) {
    return { decision: 'ask', reason: 'Modification des réglages de sécurité.' };
  }
  return { decision: 'allow' };
}

/** Décision pour un appel d'outil Claude Code (entrée du hook PreToolUse). */
export function classifyTool(toolName, input = {}, cfg = {}) {
  const mode = cfg.guard?.sensitiveMode === 'ask' ? 'ask' : 'deny';
  const sensitive = (p, verb) => (isSensitivePath(p, cfg)
    ? { decision: mode, reason: `${verb} d'un fichier sensible : ${p}` } : null);
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return classifyCommand(input.command, cfg);
    case 'Read':
      return sensitive(input.file_path, 'Lecture') ?? { decision: 'allow' };
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = input.file_path ?? input.notebook_path;
      if (isProtectedState(p)) return { decision: 'deny', reason: "L'état d'OniSkill se modifie uniquement via la CLI oniskill.mjs." };
      return sensitive(p, 'Écriture') ?? { decision: 'allow' };
    }
    case 'Grep':
      return sensitive(input.path, 'Recherche dans') ?? sensitive(input.glob, 'Recherche dans') ?? { decision: 'allow' };
    case 'WebFetch':
    case 'WebSearch':
      return looksLikeSecret(`${input.url ?? ''} ${input.prompt ?? ''} ${input.query ?? ''}`)
        ? { decision: 'deny', reason: 'La requête web contient un secret en clair.' } : { decision: 'allow' };
    default:
      return { decision: 'allow' };
  }
}
