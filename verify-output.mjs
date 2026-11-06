import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function inventory(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return inventory(join(directory, entry.name), path + '/');
    if (!entry.isFile()) throw new Error(`Unexpected output type at ${path}`);
    return [path];
  });
}

function verifyPublication(directory, publication, paths) {
  const indexPath = join(directory, 'static-publication-index.json');
  const manifestPath = join(directory, 'static-export-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const priorCopyBaseCount = paths.filter((path) =>
    /^private-copy-bases\/[a-f0-9]{64}\/static-publication-index\.json$/.test(path)).length;

  if (publication.publicationId !== manifest.publicationId ||
      publication.revisionSha256 !== manifest.revisionSha256 ||
      publication.indexSha256 !== manifest.indexSha256 ||
      publication.indexSha256 !== digest(indexPath) ||
      publication.manifestSha256 !== digest(manifestPath) ||
      publication.priorCopyBaseCount !== priorCopyBaseCount) {
    throw new Error('Publication summary differs from verified output');
  }
}

export function verifyOutput(built, lock) {
  const paths = inventory(built).sort();
  const expected = Object.keys(lock.files).sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error('Output file inventory differs');
  for (const path of expected) {
    if (digest(join(built, path)) !== lock.files[path]) throw new Error(`Output hash differs at ${path}`);
  }

  verifyPublication(built, lock.publication, paths);
  return paths.length;
}
