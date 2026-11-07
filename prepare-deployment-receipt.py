#!/usr/bin/env python3
"""Prepare a public receipt only after verifying the current Demo deployment.

Run under the existing exclusive deployment lock from a clean, merged Demo main
checkout. This command writes one new local JSON file; it never publishes it.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.request
import urllib.error
from html.parser import HTMLParser
from pathlib import Path

ORIGIN = 'https://demo.exhibitos.org/'
HEX40 = re.compile(r'^[0-9a-f]{40}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')

class Meta(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = []; self.indexes = []; self.scripts = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and a.get('name') == 'exhibitos-viewer-build-id':
            self.ids.append(a.get('content'))
        if tag == 'meta' and a.get('name') == 'exhibitos-static-index':
            self.indexes.append(a.get('content'))
        if tag == 'script' and a.get('type') == 'module' and a.get('src'):
            self.scripts.append(a['src'])

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')

def read(url, token=None, limit=4*1024*1024):
    headers = {'User-Agent': 'curl/8.7.1', 'Cache-Control': 'no-cache'}
    if token: headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        if response.geturl() != url: raise ValueError('Unexpected URL')
        data = response.read(limit + 1)
    if len(data) > limit: raise ValueError('Response exceeds limit')
    return data

def api(base, path, token):
    result = json.loads(read(base + path, token))
    if result.get('success') is not True: raise ValueError('Provider request failed')
    return result['result']

def digest(data): return hashlib.sha256(data).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], text=True, timeout=20).strip()
def entry_path(src):
    if not re.fullmatch(r'/?assets/[A-Za-z0-9_.-]+\.js', src): raise ValueError('Unexpected entry path')
    return src.removeprefix('/')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', required=True, help='Cloudflare successful build UUID')
    parser.add_argument('--account', required=True)
    parser.add_argument('--worker-id', required=True)
    parser.add_argument('--trigger', required=True)
    parser.add_argument('--output', required=True, help='New file inside private verification directory')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}', args.build): raise ValueError('Invalid build ID')
    if not re.fullmatch(r'[0-9a-f]{32}', args.account) or not re.fullmatch(r'[0-9a-f]{32}', args.worker_id) or not re.fullmatch(r'[0-9a-f-]{36}', args.trigger): raise ValueError('Invalid provider identity')
    base = 'https://api.cloudflare.com/client/v4/accounts/' + args.account
    root = Path('/Volumes/ExhibitSSD/ExhibitOS/.local/verification').resolve()
    target = Path(args.output)
    if not target.is_absolute() or not target.parent.is_dir() or target.parent.resolve() != root or target.name in ('', '.', '..') or target.exists(): raise ValueError('Output must be a new direct child of private verification directory')
    lease = Path('/Volumes/ExhibitSSD/ExhibitOS/.local/exhibitos-deployment-exhibitos-viewer-demo.lock').open('a+')
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    build_token = os.environ['CLOUDFLARE_BUILDS_API_TOKEN']
    inspection_token = os.environ['CLOUDFLARE_DEMO_INSPECTION_API_TOKEN']
    lock = json.loads(Path('demo-lock.json').read_text())
    commit, source = git('rev-parse', 'HEAD'), lock['platform']['commit']
    if not HEX40.fullmatch(commit) or not HEX40.fullmatch(source): raise ValueError('Invalid commit')
    if git('status', '--porcelain'): raise ValueError('Checkout is not clean')
    remote = git('ls-remote', '--exit-code', 'https://github.com/ExhibitOS/demo.git', 'refs/heads/main').split()[0]
    if remote != commit: raise ValueError('Checkout is not current Demo main')
    expected_build = lock['platform'].get('buildId')
    if not isinstance(expected_build, str) or not HEX64.fullmatch(expected_build): raise ValueError('Demo lock lacks reviewed runtime build ID')
    config = api(base, '/builds/workers/' + args.worker_id, build_token)
    if config.get('previews_enabled') is not False or config.get('git_repository', {}).get('repo_name') != 'demo' or config['git_repository'].get('provider_account_name') != 'ExhibitOS' or config['git_repository'].get('branch') != 'main':
        raise ValueError('Unexpected build configuration')
    triggers = api(base, '/builds/workers/' + args.worker_id + '/triggers', build_token)
    if len(triggers) != 1 or triggers[0].get('trigger_uuid') != args.trigger or triggers[0].get('external_script_id') != args.worker_id or triggers[0].get('branch_includes') != ['main'] or triggers[0].get('repo_connection', {}).get('repo_name') != 'demo' or triggers[0]['repo_connection'].get('provider_account_name') != 'ExhibitOS':
        raise ValueError('Unexpected trigger; data branch must not deploy')
    build = api(base, '/builds/builds/' + args.build, build_token)
    meta = build.get('build_trigger_metadata', {})
    if build.get('status') != 'stopped' or build.get('build_outcome') != 'success' or meta.get('branch') != 'main' or meta.get('commit_hash') != commit or meta.get('build_trigger_source') != 'push_event' or build.get('trigger', {}).get('trigger_uuid') != args.trigger or build.get('trigger', {}).get('external_script_id') != args.worker_id:
        raise ValueError('Build is not successful current main push')
    deployments = api(base, '/workers/scripts/exhibitos-viewer-demo/deployments', inspection_token)['deployments']
    current = deployments[0]; versions = current.get('versions', [])
    if len(versions) != 1 or versions[0].get('percentage') != 100: raise ValueError('Deployment not single 100%')
    version = versions[0]['version_id']; deployment = current['id']; deployed = current['created_on']
    logs = api(base, '/builds/builds/' + args.build + '/logs', build_token)
    lines = [str(line[-1]) for line in logs.get('lines', []) if line]
    version_lines = [line.strip() for line in lines if line.strip().startswith('Current Version ID:')]
    expected_count = len(lock['files'])
    if logs.get('truncated') is not False or version_lines != ['Current Version ID: ' + version] or not any(re.fullmatch(r'Verified ' + str(expected_count) + r' files in .+', line.strip()) for line in lines):
        raise ValueError('Build log does not prove deployed version and output verification')
    manifest = read(ORIGIN + 'static-export-manifest.json'); index = read(ORIGIN + 'static-publication-index.json'); html = read(ORIGIN + 'index.html')
    manifest_sha = digest(manifest); index_sha = digest(index); m = json.loads(manifest)
    if manifest_sha != lock['publication']['manifestSha256'] or index_sha != lock['publication']['indexSha256'] or m.get('indexSha256') != index_sha or m.get('format') != 'exhibitos-static-publication-v1' or m.get('publicationId') != lock['publication']['publicationId'] or m.get('revisionSha256') != lock['publication']['revisionSha256']:
        raise ValueError('Live publication differs from lock')
    entries = [x for x in m.get('files', []) if x.get('path') == 'index.html']
    if len(entries) != 1 or entries[0].get('sha256') != digest(html) or entries[0].get('bytes') != len(html) or lock['files'].get('index.html') != digest(html): raise ValueError('HTML differs from manifest')
    parsed = Meta(); parsed.feed(html.decode('utf-8'))
    if parsed.ids != [expected_build] or parsed.indexes != [index_sha] or len(parsed.scripts) != 1: raise ValueError('HTML metadata differs from lock')
    script_path = entry_path(parsed.scripts[0])
    js = read(ORIGIN + script_path); js_entries = [x for x in m['files'] if x.get('path') == script_path]
    if len(js_entries) != 1 or js_entries[0].get('sha256') != digest(js) or js_entries[0].get('bytes') != len(js) or lock['files'].get(script_path) != digest(js): raise ValueError('Entry script differs from manifest')
    if not HEX64.fullmatch(manifest_sha): raise ValueError('Invalid manifest hash')
    # Guard against a deployment changing while the public bytes were inspected.
    again = api(base, '/workers/scripts/exhibitos-viewer-demo/deployments', inspection_token)['deployments'][0]
    if again.get('id') != deployment or again.get('versions') != versions or again.get('created_on') != deployed or git('ls-remote', '--exit-code', 'https://github.com/ExhibitOS/demo.git', 'refs/heads/main').split()[0] != commit:
        raise ValueError('Deployment or main changed during verification')
    confirmed = datetime.datetime.fromisoformat(deployed.replace('Z', '+00:00'))
    if confirmed.utcoffset() != datetime.timedelta(0): raise ValueError('Deployment timestamp is not UTC')
    verified = datetime.datetime.now(datetime.timezone.utc)
    if verified < confirmed: raise ValueError('Verification precedes deployment')
    receipt = {'schema':'exhibitos-deployment-receipt-v1','artifactManifestSha256':manifest_sha,'runtimeSourceCommit':source,'buildId':parsed.ids[0], 'confirmedDeploymentAt':deployed.replace('+00:00','Z'), 'verifiedAt':verified.isoformat(timespec='milliseconds').replace('+00:00','Z'), 'deploymentId':deployment,'workerVersionId':version,'trafficPercent':100}
    if not all(re.fullmatch(r'[A-Za-z0-9-]{1,128}', value) for value in (deployment, version)): raise ValueError('Invalid provider IDs')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', deployed): raise ValueError('Invalid UTC deployment timestamp')
    fd, temporary = tempfile.mkstemp(prefix='.receipt-', dir=root)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump(receipt, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.link(temporary, target)
    finally:
        os.unlink(temporary)
    print('Prepared verified public receipt:', args.output)

if __name__ == '__main__': main()
