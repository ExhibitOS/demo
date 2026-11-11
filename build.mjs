import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, verifyOutput } from './verify-output.mjs';
import { nativeInputDirectoryKey, verifyNativeInput } from './verify-native-input.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'demo-lock.json'), 'utf8'));
const output = join(root, 'dist-demo');
const tools = join(root, '.preview-tools');
const args = process.argv.slice(2);
const preparePreview = args.length === 1 && args[0] === '--prepare-preview';
const prepareDeploy = args.length === 1 && args[0] === '--prepare-deploy';
const retainWrangler = preparePreview || prepareDeploy;
if (args.length && !retainWrangler) throw new Error('Usage: node build.mjs [--prepare-preview | --prepare-deploy]');
if (retainWrangler && existsSync(tools)) throw new Error('Wrangler tools already exist; use a fresh checkout');
const command = (program, args, cwd) =>
  execFileSync(program, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

if (preparePreview) {
  const expectedCommit = process.env.DEMO_PREVIEW_SOURCE_COMMIT;
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '') ||
      command('git', ['rev-parse', 'HEAD'], root) !== expectedCommit) {
    throw new Error('Preview build HEAD differs from the approved Demo commit');
  }
}
if (process.versions.node !== lock.toolchain.node || command('npm', ['--version'], root) !== lock.toolchain.npm) {
  throw new Error('Use the Node and npm versions in demo-lock.json');
}
if (existsSync(output)) throw new Error('Build from a checkout without an existing dist-demo');

const source = mkdtempSync(join(root, '.build-demo-'));
let content;
try {
  command('git', ['init', '--quiet'], source);
  command('git', ['fetch', '--no-tags', '--depth=1', lock.platform.url, lock.platform.commit], source);
  command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], source);
  if (command('git', ['rev-parse', 'HEAD'], source) !== lock.platform.commit ||
      command('git', ['rev-parse', 'HEAD^{tree}'], source) !== lock.platform.tree ||
      digest(join(source, 'package-lock.json')) !== lock.platform.lockSha256) {
    throw new Error('Platform source or dependency lock differs from demo-lock.json');
  }

  const buildEnv = { ...process.env };
  delete buildEnv.EXHIBITOS_QUALIFIED_REFERENCE_SOURCE;
  delete buildEnv.EXHIBITOS_REFERENCE_NATIVE_CLOSURE;
  delete buildEnv.EXHIBITOS_REFERENCE_NATIVE_INTEGRITY_SHA256;
  if (lock.content && lock.nativeClosure) throw new Error('Ambiguous reference input');
  if (lock.nativeClosure) {
    const c = lock.nativeClosure;
    if (c.url !== 'https://github.com/ExhibitOS/demo.git' || !/^[a-f0-9]{40}$/.test(c.commit) || !/^[a-f0-9]{40}$/.test(c.tree) || !/^[a-f0-9]{64}$/.test(c.indexSha256)) throw new Error('Invalid native closure pin');
    content = mkdtempSync(join(root, '.content-demo-'));
    command('git', ['init', '--quiet'], content);
    command('git', ['fetch', '--no-tags', '--depth=1', c.url, c.commit], content);
    command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], content);
    if (command('git', ['rev-parse', 'HEAD'], content) !== c.commit || command('git', ['rev-parse', 'HEAD^{tree}'], content) !== c.tree) throw new Error('Native content commit/tree differs');
    const parent = join(content, 'reference-native');
    if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw new Error('Invalid native content parent');
    const dir = join(parent, nativeInputDirectoryKey(c));
    verifyNativeInput(dir, c, lock.publication, lock.platform);
    buildEnv.EXHIBITOS_REFERENCE_NATIVE_CLOSURE = dir;
    buildEnv.EXHIBITOS_REFERENCE_NATIVE_INTEGRITY_SHA256 = c.inventorySha256;
  } else if (lock.content) {
    const c = lock.content;
    if (c.url !== 'https://github.com/ExhibitOS/demo.git' || !/^[a-f0-9]{40}$/.test(c.commit) || !/^[a-f0-9]{40}$/.test(c.tree) || !/^[a-f0-9]{64}$/.test(c.indexSha256) || !/^[a-f0-9]{64}$/.test(c.inventorySha256) || c.indexSha256 !== lock.publication.indexSha256) throw new Error('Invalid content pin');
    content = mkdtempSync(join(root, '.content-demo-'));
    command('git', ['init', '--quiet'], content);
    command('git', ['fetch', '--no-tags', '--depth=1', c.url, c.commit], content);
    command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], content);
    if (command('git', ['rev-parse', 'HEAD'], content) !== c.commit || command('git', ['rev-parse', 'HEAD^{tree}'], content) !== c.tree) throw new Error('Content commit/tree differs');
    const dir = join(content, 'reference-content', c.indexSha256);
    for (const part of [join(content, 'reference-content'), dir, join(dir, 'data')]) if (!lstatSync(part).isDirectory() || lstatSync(part).isSymbolicLink()) throw new Error('Invalid content directory');
    const inventoryPath = join(dir, 'integrity.json');
    if (lstatSync(inventoryPath).isSymbolicLink() || digest(inventoryPath) !== c.inventorySha256) throw new Error('Content inventory differs');
    const inv = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    if (inv.format !== 'exhibitos-reference-content-v1' || inv.indexSha256 !== c.indexSha256 || !Array.isArray(inv.files) || inv.files.length !== 60) throw new Error('Invalid content inventory');
    const names = inv.files.map((e) => e.path);
    if (new Set(names).size !== names.length || names.filter((n) => n === 'static-publication-index.json').length !== 1 || names.some((n) => n !== 'static-publication-index.json' && !/^data\/[a-f0-9]{64}\.(?:bin|json)$/.test(n))) throw new Error('Invalid content path');
    const actual = ['static-publication-index.json', ...readdirSync(join(dir, 'data')).map((n) => `data/${n}`)].sort();
    if (JSON.stringify([...names].sort()) !== JSON.stringify(actual) || JSON.stringify(readdirSync(dir).sort()) !== JSON.stringify(['data', 'integrity.json', 'static-publication-index.json'].sort())) throw new Error('Content inventory differs');
    for (const entry of inv.files) { const path = join(dir, entry.path); const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 25 * 1024 * 1024 || stat.size !== entry.bytes || !/^[a-f0-9]{64}$/.test(entry.sha256) || digest(path) !== entry.sha256) throw new Error(`Invalid content file ${entry.path}`); }
    if (digest(join(dir, 'static-publication-index.json')) !== c.indexSha256) throw new Error('Content index differs');
    buildEnv.EXHIBITOS_QUALIFIED_REFERENCE_SOURCE = dir;
  } else if (lock.publication.indexSha256 === '7d77d80637fbd1e3354ad142fdedee5a6f7af0f08c6a4daaec96bb253c90e475') throw new Error('Qualified content pin required');
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build:reference-demo'], { cwd: source, stdio: 'inherit', env: buildEnv });
  const built = join(source, 'dist-demo');
  const count = verifyOutput(built, lock);
  if (retainWrangler) {
    const installed = JSON.parse(readFileSync(join(source, 'node_modules/wrangler/package.json'), 'utf8'));
    if (installed.version !== lock.toolchain.wrangler) throw new Error('Wrangler version differs from demo-lock.json');
    renameSync(source, tools);
    renameSync(join(tools, 'dist-demo'), output);
  } else {
    renameSync(built, output);
  }
  console.log(`Verified ${count} files in ${output}`);
} finally {
  rmSync(source, { recursive: true, force: true });
  if (content) rmSync(content, { recursive: true, force: true });
}
