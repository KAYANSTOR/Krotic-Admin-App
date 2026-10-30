import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * حرّاس المعمارية «المحلية أولًا»: تمنع رجوع القراءة الكاملة من Firestore
 * إلى الشاشات. أي استثناء مسموح مذكور صريحًا هنا مع سببه.
 */

const SRC = new URL('../src/', import.meta.url);

async function listSourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...await listSourceFiles(target));
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const read = (url) => readFile(url, 'utf8');

test('no screen imports the removed legacy Firestore read layer', async () => {
  const files = await listSourceFiles();
  const offenders = [];
  for (const file of files) {
    const source = await read(file);
    if (/from\s+['"][^'"]*lib\/adminData['"]/.test(source)) offenders.push(file.pathname);
    if (/from\s+['"][^'"]*adminDataCache['"]/.test(source)) offenders.push(file.pathname);
  }
  assert.deepEqual(offenders, []);
});

