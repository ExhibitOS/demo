import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './verify-output.mjs';

const hex64 = /^[a-f0-9]{64}$/;
const hex40 = /^[a-f0-9]{40}$/;

function inventory(root, prefix = '') {
  const paths = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in native input: ${name}`);
    if (entry.isDirectory()) paths.push(...inventory(root, name));
    else if (entry.isFile()) paths.push(name);
    else throw new Error(`Invalid native input type: ${name}`);
  }
  return paths;
}

export function nativeInputDirectoryKey(pin) {
  if (pin.inputId === undefined) return pin.indexSha256;
  if (!hex64.test(pin.inputId) || pin.inputId !== pin.inventorySha256) throw new Error('Invalid native input directory pin');
  return pin.inputId;
}

export function verifyNativeInput(dir, pin, publication, platform) {
  const rootStat = lstatSync(dir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid native input directory');
  if (!hex64.test(pin.inventorySha256) || !hex64.test(pin.sourceManifestSha256) || !hex64.test(pin.indexSha256) || pin.indexSha256 !== publication.indexSha256 || !hex40.test(platform.viewerSourceCommit ?? '') || !hex40.test(platform.viewerSourceTree ?? '')) throw new Error('Invalid native input pins');
  const integrityPath = join(dir, 'integrity.json');
  const integrityStat = lstatSync(integrityPath);
  if (!integrityStat.isFile() || integrityStat.isSymbolicLink() || digest(integrityPath) !== pin.inventorySha256) throw new Error('Native inventory differs');
  const inv = JSON.parse(readFileSync(integrityPath, 'utf8'));
  const fileCount = pin.fileCount ?? 178;
  if (![178, 179, 184].includes(fileCount) || inv.format !== 'exhibitos-reference-native-input-v1' || inv.indexSha256 !== pin.indexSha256 || !Array.isArray(inv.files) || inv.files.length !== fileCount) throw new Error('Invalid native inventory');
  const paths = inv.files.map(e => e.path);
  if (new Set(paths).size !== paths.length || paths.some(p => typeof p !== 'string' || !/^(?:closure\.json|web-inventory\.json|(?:source|web)\/[A-Za-z0-9_.\/-]+)$/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..'))) throw new Error('Invalid native input path');
  const actual = inventory(dir).filter(p => p !== 'integrity.json').sort();
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(actual)) throw new Error('Native input inventory differs');
  for (const entry of inv.files) {
    const path = join(dir, entry.path); const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 25 * 1024 * 1024 || stat.size !== entry.bytes || !hex64.test(entry.sha256) || digest(path) !== entry.sha256) throw new Error(`Invalid native input file ${entry.path}`);
  }
  const closure = JSON.parse(readFileSync(join(dir, 'closure.json'), 'utf8'));
  if (closure.format !== 'exhibitos-reference-native-closure-v1' || closure.publication?.publicationId !== publication.publicationId || closure.publication?.revisionSha256 !== publication.revisionSha256 || closure.publication?.indexSha256 !== publication.indexSha256 || closure.publication?.manifestSha256 !== pin.sourceManifestSha256 || closure.viewer?.sourceCommit !== platform.viewerSourceCommit || closure.viewer?.sourceTree !== platform.viewerSourceTree || closure.viewer?.buildId !== platform.buildId || closure.paths?.source !== 'source' || closure.paths?.web !== 'web' || closure.paths?.webInventory !== 'web-inventory.json') throw new Error('Native closure identity differs');
  return inv.files.length;
}
