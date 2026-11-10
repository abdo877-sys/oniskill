// Scanner : résumé compact d'un projet (pour économiser le contexte) + commandes de test détectées.
import fs from 'node:fs';
import path from 'node:path';
import { statePath, writeJsonAtomic, nowIso } from './store.mjs';

const KEY_FILES = ['README.md', 'README', 'CLAUDE.md', 'AGENTS.md', 'Makefile', 'Dockerfile', 'docker-compose.yml',
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'pytest.ini', 'tox.ini',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', '.gitignore'];

function detectTests(dir, has) {
  const cmds = [];
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const t = pkg.scripts?.test;
      if (t && !/no test specified/i.test(t)) {
        const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
        cmds.push({ command: `${pm} test`, source: 'package.json scripts.test' });
      }
    } catch { /* package.json illisible : pas de commande déduite */ }
  }
  if (has('pytest.ini') || has('tox.ini') || has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    const hasTests = ['tests', 'test'].some((d) => fs.existsSync(path.join(dir, d)));
    if (hasTests || has('pytest.ini')) cmds.push({ command: 'python -m pytest -q', source: 'projet Python avec tests' });
  }
  if (has('Cargo.toml')) cmds.push({ command: 'cargo test', source: 'Cargo.toml' });
  if (has('go.mod')) cmds.push({ command: 'go test ./...', source: 'go.mod' });
  if (has('pom.xml')) cmds.push({ command: 'mvn -q test', source: 'pom.xml' });
  if (has('build.gradle') || has('build.gradle.kts')) cmds.push({ command: 'gradle test', source: 'Gradle' });
  if (has('composer.json') && fs.existsSync(path.join(dir, 'vendor', 'bin', 'phpunit'))) cmds.push({ command: 'vendor/bin/phpunit', source: 'PHPUnit' });
  if (has('Makefile')) {
    try {
      if (/^test\s*:/m.test(fs.readFileSync(path.join(dir, 'Makefile'), 'utf8'))) cmds.push({ command: 'make test', source: 'Makefile' });
    } catch { /* ignoré */ }
  }
  return cmds;
}

export function scanProject(projectDir, cfg, { save = true } = {}) {
  const ext = {};
  const topDirs = {};
  let files = 0, bytes = 0, truncated = false;
  const stack = [''];
  while (stack.length && !truncated) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(projectDir, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (cfg.scanIgnore.includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(r); continue; }
      if (!e.isFile()) continue;
      if (++files > cfg.scanMaxFiles) { truncated = true; break; }
      try { bytes += fs.statSync(path.join(projectDir, r)).size; } catch { /* fichier disparu entre-temps */ }
      const x = path.extname(e.name).toLowerCase() || '(sans extension)';
      ext[x] = (ext[x] ?? 0) + 1;
      const top = r.includes('/') ? r.split('/')[0] : '.';
      topDirs[top] = (topDirs[top] ?? 0) + 1;
    }
  }
  const has = (f) => fs.existsSync(path.join(projectDir, f));
  const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
  const result = {
    scannedAt: nowIso(),
    root: projectDir,
    files: truncated ? `> ${cfg.scanMaxFiles}` : files,
    bytes,
    truncated,
    git: has('.git'),
    extensions: top(ext, 12),
    topDirs: top(topDirs, 15),
    keyFiles: KEY_FILES.filter(has),
    testCommands: detectTests(projectDir, has),
  };
  if (save) writeJsonAtomic(statePath(projectDir, 'scan.json'), result);
  return result;
}
