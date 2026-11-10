import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { oni } from './helpers.mjs';

test('doctor : tous les contrôles passent, sans init préalable et sans laisser de trace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniskill-test-'));
  const r = oni(dir, 'doctor');
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(r.out.ok, true);
  assert.deepEqual(r.out.checks.filter((c) => !c.ok), []);
  assert.equal(r.out.checks.length, 6);
  assert.deepEqual(fs.readdirSync(dir), []);
});
