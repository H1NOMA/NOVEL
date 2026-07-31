// Desktop packaging: stage a minimal app payload (dist + electron shell) and
// run @electron/packager on it, so the final build contains no node_modules,
// sources, or tooling. Usage: node scripts/package.mjs <win32|linux|darwin> [arch]
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2] ?? 'win32';
const arch = process.argv[3] ?? (platform === 'darwin' ? 'arm64' : 'x64');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const staging = join(root, 'release', 'staging');

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(join(root, 'dist'), join(staging, 'dist'), { recursive: true });
cpSync(join(root, 'electron'), join(staging, 'electron'), { recursive: true });
writeFileSync(
  join(staging, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      productName: 'The Second Galactic War',
      version: pkg.version,
      description: pkg.description,
      main: 'electron/main.cjs',
    },
    null,
    2
  )
);

const [out] = await packager({
  dir: staging,
  name: 'SecondGalacticWar',
  platform,
  arch,
  out: join(root, 'release'),
  overwrite: true,
  asar: true,
  appCopyright: 'Fan-made strategy in the Helldivers 2 setting',
});

rmSync(staging, { recursive: true, force: true });
console.log('Packaged:', out);
