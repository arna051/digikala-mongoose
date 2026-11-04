import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{36,255}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /mongodb(?:\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
];
const files = execFileSync('git', [
  'ls-files',
  '-z',
  '--cached',
  '--others',
  '--exclude-standard',
])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const findings = [];

for (const file of files) {
  const content = await readFile(file, 'utf8').catch(() => '');
  if (patterns.some((pattern) => pattern.test(content))) findings.push(file);
}

if (findings.length) {
  throw new Error(
    `Possible secrets found in tracked files: ${findings.join(', ')}`,
  );
}
console.log('No high-confidence secrets found in tracked files.');
