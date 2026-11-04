import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'digikala-mongoose-consumer-'));

try {
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  const packed = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        root,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ],
      { encoding: 'utf8' },
    ),
  );
  const tarball = join(directory, packed[0].filename);
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
      'mongoose@8',
      '@nestjs/common@11',
      'reflect-metadata',
      'rxjs',
    ],
    { cwd: directory, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import root from 'node:assert/strict';
        import * as pkg from 'digikala-mongoose';
        import * as nest from 'digikala-mongoose/nestjs';
        import * as qdrant from 'digikala-mongoose/qdrant';
        root.equal(typeof pkg.createDigikalaMongoose, 'function');
        root.equal(typeof pkg.createDigikalaStandaloneOrchestrator, 'function');
        root.equal(typeof nest.DigikalaMongooseModule.forRootAsync, 'function');
        root.equal(typeof qdrant.createDigikalaQdrantIndex, 'function');
      `,
    ],
    { cwd: directory, stdio: 'pipe' },
  );
  console.log('Published tarball installs and imports in a clean consumer.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
