import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const entries = [
  { name: 'background', file: 'src/background.ts' },
  { name: 'bridge', file: 'src/bridge.ts' },
  { name: 'options', file: 'src/options.ts' },
];

for (const [index, entry] of entries.entries()) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      outDir: dist,
      emptyOutDir: index === 0,
      minify: false,
      lib: {
        entry: path.join(root, entry.file),
        formats: ['iife'],
        name: entry.name,
        fileName: () => `${entry.name}.js`,
      },
    },
  });
}

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
copyFileSync(path.join(root, 'options.html'), path.join(dist, 'options.html'));
console.log(`built extension ${pkg.version} -> ${dist}`);
