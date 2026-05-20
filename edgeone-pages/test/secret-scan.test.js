import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ignoredDirs = new Set(['.git', 'node_modules', '.edgeone', '.codex-tmp']);
const ignoredFiles = new Set(['package-lock.json']);
const rules = [
  { name: 'Cloudflare API Token', pattern: /cfut_[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub Fine-grained Token', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: '11 位手机号', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { name: '明文 SecretKey', pattern: /SecretKey\s*=\s*[A-Za-z0-9_-]{12,}/gi },
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full));
    if (entry.isFile() && !ignoredFiles.has(entry.name)) files.push(full);
  }
  return files;
}

test('仓库不包含真实手机号或访问令牌', async () => {
  const findings = [];
  for (const file of await collectFiles(root)) {
    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const rule of rules) {
      const matches = content.match(rule.pattern);
      if (matches?.length) {
        findings.push(`${path.relative(root, file)} 命中 ${rule.name} ${matches.length} 次`);
      }
    }
  }
  assert.deepEqual(findings, []);
});
