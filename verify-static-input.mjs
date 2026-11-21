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
  if (!hex64.test(pin.inputId ?? '') || pin.inventorySha256 !== pin.inputId || !Number.isSafeInteger(pin.fileCount) || pin.fileCount <= 0 || pin.fileCount !== Object.keys(lock.files).length) throw new Error('Invalid static input pin');
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Invalid static input root');
  const rootNames = readdirSync(dir).sort();
  const inventory = join(dir, 'integrity.json');
  if (!lstatSync(inventory).isFile() || lstatSync(inventory).isSymbolicLink() || digest(inventory) !== pin.inventorySha256) throw new Error('Static integrity digest differs');
  const inv = JSON.parse(readFileSync(inventory, 'utf8'));
  const derived = inv.format === 'exhibitos-reference-static-input-derived-v2';
  const direct = inv.format === 'exhibitos-reference-static-input-v1';
  if (!keys(inv, derived ? ['format', 'publication', 'viewer', 'files', 'provenance'] : ['format', 'publication', 'viewer', 'files']) || (!derived && !direct) || !keys(inv.publication, derived ? ['publicationId','revisionSha256','indexSha256','manifestSha256'] : ['publicationId','revisionSha256','indexSha256','nativeManifestSha256','manifestSha256']) || !keys(inv.viewer, ['sourceCommit','sourceTree','lockSha256','buildId']) || !Array.isArray(inv.files) || inv.files.length !== pin.fileCount) throw new Error('Invalid static inventory schema');
  if (JSON.stringify(rootNames) !== JSON.stringify(derived ? ['custody.json', 'integrity.json', 'output'] : ['integrity.json', 'output'])) throw new Error('Invalid static input root inventory');
  for (const k of ['publicationId','revisionSha256','indexSha256','manifestSha256']) if (inv.publication[k] !== lock.publication[k]) throw new Error(`Static publication ${k} differs`);
  if (direct) {
    if ('provenance' in pin || inv.publication.nativeManifestSha256 !== pin.nativeManifestSha256 || !hex64.test(pin.nativeManifestSha256 ?? '')) throw new Error('Static native manifest differs');
  } else {
    const fields = ['predecessorNativeManifestSha256','predecessorStaticManifestSha256','predecessorDeploymentReceiptSha256','sourceCustodySha256','custodyProjectionSha256'];
    if ('nativeManifestSha256' in pin || !keys(inv.provenance, fields) || !keys(pin.provenance, fields) || fields.some(k => !hex64.test(inv.provenance[k] ?? '') || inv.provenance[k] !== pin.provenance[k])) throw new Error('Derived static provenance differs');
    const path = join(dir, 'custody.json'), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || digest(path) !== pin.provenance.custodyProjectionSha256) throw new Error('Derived custody digest differs');
    const c = JSON.parse(readFileSync(path, 'utf8'));
    const cfields = ['format','predecessorNativeManifestSha256','predecessorStaticManifestSha256','predecessorDeploymentReceiptSha256','sourceCustodySha256','manifestSha256','indexSha256'];
    if (!keys(c, cfields) || c.format !== 'exhibitos-derived-static-custody-v1' || fields.slice(0, 4).some(k => c[k] !== pin.provenance[k]) || c.manifestSha256 !== lock.publication.manifestSha256 || c.indexSha256 !== lock.publication.indexSha256) throw new Error('Derived custody identity differs');
  }
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
