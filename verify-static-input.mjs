import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, verifyOutput } from './verify-output.mjs';

const hex64 = /^[a-f0-9]{64}$/;
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...expected].sort());
function walk(dir, prefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (!entries.length) throw new Error(`Unexpected empty directory: ${prefix}`);
  return entries.flatMap((entry) => {
    const p = prefix + entry.name;
    if (entry.isDirectory()) return walk(join(dir, entry.name), p + '/');
    if (!entry.isFile()) throw new Error(`Unexpected static input type: ${p}`);
    return [p];
  });
}
export function verifyStaticInput(dir, pin, lock) {
  if (!hex64.test(pin.inputId ?? '') || pin.inventorySha256 !== pin.inputId || pin.fileCount !== 153) throw new Error('Invalid static input pin');
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Invalid static input root');
  if (JSON.stringify(readdirSync(dir).sort()) !== JSON.stringify(['integrity.json', 'output'])) throw new Error('Invalid static input root inventory');
  const inventory = join(dir, 'integrity.json');
  if (!lstatSync(inventory).isFile() || lstatSync(inventory).isSymbolicLink() || digest(inventory) !== pin.inventorySha256) throw new Error('Static integrity digest differs');
  const inv = JSON.parse(readFileSync(inventory, 'utf8'));
  if (!keys(inv, ['format', 'publication', 'viewer', 'files']) || inv.format !== 'exhibitos-reference-static-input-v1' || !keys(inv.publication, ['publicationId','revisionSha256','indexSha256','nativeManifestSha256','manifestSha256']) || !keys(inv.viewer, ['sourceCommit','sourceTree','lockSha256','buildId']) || !Array.isArray(inv.files) || inv.files.length !== pin.fileCount) throw new Error('Invalid static inventory schema');
  for (const k of ['publicationId','revisionSha256','indexSha256','manifestSha256']) if (inv.publication[k] !== lock.publication[k]) throw new Error(`Static publication ${k} differs`);
  if (inv.publication.nativeManifestSha256 !== pin.nativeManifestSha256 || !hex64.test(pin.nativeManifestSha256 ?? '')) throw new Error('Static native manifest differs');
  for (const [a,b] of [['sourceCommit','viewerSourceCommit'],['sourceTree','viewerSourceTree'],['lockSha256','lockSha256'],['buildId','buildId']]) if (inv.viewer[a] !== lock.platform[b]) throw new Error(`Static viewer ${a} differs`);
  const root = join(dir, 'output');
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Invalid static output root');
  const names = [];
  for (const e of inv.files) {
    if (!keys(e, ['path','bytes','sha256']) || typeof e.path !== 'string' || !/^output\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(e.path) || e.path.split('/').some(x => x === '.' || x === '..') || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || e.bytes > 25 * 1024 * 1024 || !hex64.test(e.sha256 ?? '')) throw new Error('Invalid static inventory entry');
    const name = e.path.slice(7); names.push(name);
    if (lock.files[name] !== e.sha256) throw new Error(`Static lock differs: ${name}`);
    const path = join(dir, e.path), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== e.bytes || digest(path) !== e.sha256) throw new Error(`Static file differs: ${name}`);
  }
  if (new Set(names).size !== pin.fileCount || JSON.stringify(names.sort()) !== JSON.stringify(walk(root).sort()) || JSON.stringify(names.sort()) !== JSON.stringify(Object.keys(lock.files).sort())) throw new Error('Static output inventory differs');
  return verifyOutput(root, lock);
}
