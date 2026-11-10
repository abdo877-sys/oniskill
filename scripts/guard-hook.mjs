#!/usr/bin/env node
// Hook PreToolUse : lit l'appel d'outil sur stdin et répond deny / ask, ou rien (flux de permission normal).
// Ne répond jamais « allow » : la garde peut refuser, elle n'accorde aucune permission.
import fs from 'node:fs';
import path from 'node:path';
import { findProjectDir, statePath } from './lib/store.mjs';
import { loadConfig } from './lib/config.mjs';
import { classifyTool } from './lib/guard.mjs';

function respond(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: `[OniSkill] ${reason}` },
  }));
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const projectDir = findProjectDir(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const cfg = loadConfig(projectDir);
  if (cfg.guard.enabled) {
    const r = classifyTool(input.tool_name, input.tool_input ?? {}, cfg);
    if (r.decision !== 'allow') {
      respond(r.decision, r.reason);
      if (fs.existsSync(statePath(projectDir))) {
        const entry = { ts: new Date().toISOString(), tool: input.tool_name, agent: input.agent_type ?? 'principal', decision: r.decision, reason: r.reason };
        try { fs.appendFileSync(path.join(statePath(projectDir), 'guard.log'), JSON.stringify(entry) + '\n'); } catch { /* journal facultatif */ }
      }
    }
  }
} catch (e) {
  // En cas de panne de la garde, on demande une confirmation humaine plutôt que de laisser passer en silence.
  respond('ask', `Garde en erreur (${e.message}) : confirmation manuelle requise.`);
}
