import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOutput } from './verify-output.mjs';

const { DEMO_PREVIEW_WORKER, DEMO_PREVIEW_NAME, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = process.env;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
if (!label.test(DEMO_PREVIEW_WORKER ?? '') || !DEMO_PREVIEW_WORKER.endsWith('-preview') ||
    !label.test(DEMO_PREVIEW_NAME ?? '') ||
    ['main', 'production', 'live'].includes(DEMO_PREVIEW_NAME) ||
    !/^[a-f0-9]{32}$/.test(CLOUDFLARE_ACCOUNT_ID ?? '') || !CLOUDFLARE_API_TOKEN) {
  throw new Error('Set the approved isolated preview Worker, preview name, Cloudflare account and API token');
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
], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
