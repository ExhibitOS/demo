import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOutput } from './verify-output.mjs';

const {
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DEMO_DEPLOY_WORKER_ID,
  EXHIBITOS_APPROVED_DEMO_INDEX_SHA256,
} = process.env;
const workerId = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
if (process.argv.length !== 2 || !/^[a-f0-9]{32}$/.test(CLOUDFLARE_ACCOUNT_ID ?? '') ||
    !CLOUDFLARE_API_TOKEN || !workerId.test(DEMO_DEPLOY_WORKER_ID ?? '')) {
  throw new Error('Set the approved Cloudflare account, API token and immutable Worker ID');
}

const root = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'demo-lock.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(EXHIBITOS_APPROVED_DEMO_INDEX_SHA256 ?? '') ||
    lock.publication.indexSha256 !== EXHIBITOS_APPROVED_DEMO_INDEX_SHA256) {
  throw new Error('Demo lock differs from the approved publication index');
}

const configPath = join(root, 'wrangler.demo.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const wrangler = join(root, '.preview-tools/node_modules/wrangler');
const installed = JSON.parse(readFileSync(join(wrangler, 'package.json'), 'utf8'));
if (process.versions.node !== lock.toolchain.node || installed.version !== lock.toolchain.wrangler) {
  throw new Error('Deployment toolchain differs from demo-lock.json');
}

verifyOutput(join(root, 'dist-demo'), lock);
const api = 'https://api.cloudflare.com/client/v4';
const response = await fetch(`${api}/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/workers/${config.name}`, {
  headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
});
if (!response.ok) throw new Error(`Cannot verify deployment Worker (HTTP ${response.status})`);
const identity = await response.json();
if (identity.success !== true || identity.result?.id !== DEMO_DEPLOY_WORKER_ID ||
    identity.result?.name !== config.name) {
  throw new Error('Deployment Worker identity differs from the approved target');
}

execFileSync(process.execPath, [join(wrangler, 'bin/wrangler.js'), 'deploy', '--config', configPath], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_API_BASE_URL: api, WRANGLER_SEND_METRICS: 'false' },
});
