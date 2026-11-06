import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, verifyOutput } from './verify-output.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'demo-lock.json'), 'utf8'));
const output = join(root, 'dist-demo');
const tools = join(root, '.preview-tools');
const args = process.argv.slice(2);
const preparePreview = args.length === 1 && args[0] === '--prepare-preview';
if (args.length && !preparePreview) throw new Error('Usage: node build.mjs [--prepare-preview]');
if (preparePreview && existsSync(tools)) throw new Error('Preview tools already exist; use a fresh checkout');
const command = (program, args, cwd) =>
  execFileSync(program, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

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
  const count = verifyOutput(built, lock);
  if (preparePreview) {
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
}
