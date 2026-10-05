/**
 * Generates the installable Krotak Pro icons from the reviewed brand artwork.
 * The pre-sized source assets live in scripts/icon-assets so builds are offline,
 * repeatable, and keep the same icon across PWA, Apple touch, and browser tabs.
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sourceDir = join(__dirname, 'icon-assets');
const outDir = join(root, 'public', 'icons');

mkdirSync(outDir, { recursive: true });

const copies = [
  ['krotak-pro-512.png', join(outDir, 'krotak-pro-512.png')],
  ['krotak-pro-192.png', join(outDir, 'krotak-pro-192.png')],
  ['krotak-pro-180.png', join(outDir, 'krotak-pro-180.png')],
  ['krotak-pro-48.png', join(outDir, 'krotak-pro-48.png')],
  ['krotak-pro-32.png', join(outDir, 'krotak-pro-32.png')],
  ['krotak-pro-16.png', join(outDir, 'krotak-pro-16.png')],
  ['app_icon.png', join(outDir, 'app_icon.png')],
  ['favicon.ico', join(root, 'public', 'favicon.ico')],
  ['favicon.ico', join(outDir, 'favicon.ico')],
];

for (const [sourceName, target] of copies) {
  const source = join(sourceDir, sourceName);
  if (!existsSync(source)) {
    throw new Error(`Required Krotak icon asset is missing: ${source}`);
  }
  copyFileSync(source, target);
}

console.log(`Krotak Pro install icons ready (${copies.length} files).`);
