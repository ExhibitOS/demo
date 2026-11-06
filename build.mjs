import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'demo-lock.json'), 'utf8'));
const output = join(root, 'dist-demo');
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const command = (program, args, cwd) =>
  execFileSync(program, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

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

if (process.versions.node !== lock.toolchain.node || command('npm', ['--version'], root) !== lock.toolchain.npm) {
  throw new Error('Use the Node and npm versions in demo-lock.json');
}
if (existsSync(output)) throw new Error('Build from a checkout without an existing dist-demo');

const source = mkdtempSync(join(root, '.build-demo-'));
try {
  command('git', ['init', '--quiet'], source);
  command('git', ['fetch', '--no-tags', '--depth=1', lock.platform.url, lock.platform.commit], source);
  command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], source);
  if (command('git', ['rev-parse', 'HEAD'], source) !== lock.platform.commit ||
      command('git', ['rev-parse', 'HEAD^{tree}'], source) !== lock.platform.tree ||
      digest(join(source, 'package-lock.json')) !== lock.platform.lockSha256) {
    throw new Error('Platform source or dependency lock differs from demo-lock.json');
  }

  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build:reference-demo'], { cwd: source, stdio: 'inherit' });
  const built = join(source, 'dist-demo');
  const paths = inventory(built).sort();
  const expected = Object.keys(lock.files).sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error('Output file inventory differs');
  for (const path of expected) {
    if (digest(join(built, path)) !== lock.files[path]) throw new Error(`Output hash differs at ${path}`);
  }

  verifyPublication(built, lock.publication, paths);
  renameSync(built, output);
  console.log(`Verified ${paths.length} files in ${output}`);
} finally {
  rmSync(source, { recursive: true, force: true });
}
