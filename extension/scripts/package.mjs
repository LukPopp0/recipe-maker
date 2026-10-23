import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });

execFileSync('pnpm', ['dlx', 'web-ext@8', 'build', '-s', 'dist', '-a', 'artifacts', '--overwrite-dest'], {
  cwd: root,
  stdio: 'inherit',
});

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const zip = readdirSync(artifacts).find((f) => f.endsWith(`-${pkg.version}.zip`));
if (!zip) throw new Error(`web-ext produced no zip for version ${pkg.version}`);
copyFileSync(path.join(artifacts, zip), path.join(artifacts, 'recipe-maker-chrome.zip'));
console.log(`copied ${zip} -> artifacts/recipe-maker-chrome.zip`);
