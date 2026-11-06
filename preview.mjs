import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOutput } from './verify-output.mjs';

const {
  DEMO_PREVIEW_WORKER, DEMO_PREVIEW_NAME, DEMO_PREVIEW_WORKER_ID,
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
} = process.env;
const workerId = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
if (DEMO_PREVIEW_NAME !== 'verify-ba66d909' ||
    DEMO_PREVIEW_WORKER !== `exhibitos-${DEMO_PREVIEW_NAME}-preview` ||
    !workerId.test(DEMO_PREVIEW_WORKER_ID ?? '') ||
    !/^[a-f0-9]{32}$/.test(CLOUDFLARE_ACCOUNT_ID ?? '') || !CLOUDFLARE_API_TOKEN) {
  throw new Error('Set the approved nonce preview names, existing Worker ID, Cloudflare account and API token');
}

async function checkFreshTarget(base, workerName, expectedId, previewName, token) {
  const get = (path) => fetch(base + path, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });

  const worker = await get('/' + workerName);
  if (!worker.ok) throw new Error(`Cannot verify existing preview Worker (HTTP ${worker.status})`);
  const identity = await worker.json();
  if (identity.success !== true || identity.result?.id !== expectedId || identity.result?.name !== workerName) {
    throw new Error('Preview Worker identity differs from the approved target');
  }

  const preview = await get(`/${workerName}/previews/${previewName}`);
  if (preview.status !== 404) throw new Error(`Fresh Preview absence not confirmed (HTTP ${preview.status})`);
  const absence = await preview.json();
  if (absence.success !== false || absence.errors?.length !== 1 || absence.errors[0].code !== 10025) {
    throw new Error('Cloudflare did not confirm the named Preview is absent');
  }
}

if (process.argv.length !== 2) throw new Error('Usage: node preview.mjs');

const root = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'demo-lock.json'), 'utf8'));
const output = join(root, 'dist-demo');
const tools = join(root, '.preview-tools');
const wrangler = join(tools, 'node_modules/wrangler');
const installed = JSON.parse(readFileSync(join(wrangler, 'package.json'), 'utf8'));
if (process.versions.node !== lock.toolchain.node || installed.version !== lock.toolchain.wrangler) {
  throw new Error('Preview toolchain differs from demo-lock.json');
}

verifyOutput(output, lock);
const api = 'https://api.cloudflare.com/client/v4';
await checkFreshTarget(`${api}/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/workers`,
  DEMO_PREVIEW_WORKER, DEMO_PREVIEW_WORKER_ID, DEMO_PREVIEW_NAME, CLOUDFLARE_API_TOKEN);
const config = join(tools, 'wrangler.preview.json');
writeFileSync(config, JSON.stringify({
  name: DEMO_PREVIEW_WORKER,
  account_id: CLOUDFLARE_ACCOUNT_ID,
  compatibility_date: '2026-10-25',
  assets: { directory: output, html_handling: 'auto-trailing-slash', not_found_handling: 'none' },
  previews: {},
}), { flag: 'wx', mode: 0o600 });
execFileSync(process.execPath, [
  join(wrangler, 'bin/wrangler.js'), 'preview', '--config', config,
  '--worker-name', DEMO_PREVIEW_WORKER, '--name', DEMO_PREVIEW_NAME,
  '--ignore-base-config', '--json',
], { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_API_BASE_URL: api, WRANGLER_SEND_METRICS: 'false' } });
