/**
 * يولّد أيقونات لوحة التحكم من الأيقونة الرسمية لتطبيق الأندرويد (Krotak-Pro).
 * المصدر: https://github.com/KAYANSTOR/Krotak-Pro/blob/main/assets/icon/app_icon.png
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'icons');
const SOURCE_URL =
  'https://raw.githubusercontent.com/KAYANSTOR/Krotak-Pro/main/assets/icon/app_icon.png';
const CACHE_PATH = join(__dirname, 'app_icon_cache.png');

mkdirSync(outDir, { recursive: true });

async function loadSource() {
  if (existsSync(CACHE_PATH)) {
    return readFileSync(CACHE_PATH);
  }
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to download official icon: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(CACHE_PATH, buf);
  return buf;
}

async function main() {
  const sourceBuf = await loadSource();
  const targets = [
    join(outDir, 'krotak-pro-512.png'),
    join(outDir, 'krotak-pro-192.png'),
    join(outDir, 'krotak-pro-180.png'),
    join(outDir, 'krotak-pro-48.png'),
    join(outDir, 'krotak-pro-32.png'),
    join(outDir, 'krotak-pro-16.png'),
    join(outDir, 'app_icon.png'),
    join(root, 'public', 'favicon.ico'),
    join(outDir, 'favicon.ico'),
  ];

  for (const target of targets) {
    writeFileSync(target, sourceBuf);
  }
  console.log('Krotak Pro icons synced from official Android app icon.');
  console.log('Source:', SOURCE_URL);
  console.log('Wrote', targets.length, 'files to public/icons');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
