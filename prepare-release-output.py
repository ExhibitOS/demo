#!/usr/bin/env python3
"""Copy a verified release output into an owned, clean Demo worktree."""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path

WORKTREES = Path('/Volumes/ExhibitSSD/ExhibitOS/worktrees/demo')
SOURCES = Path('/Volumes/ExhibitSSD/ExhibitOS/.local/workspace')
HEX = re.compile(r'^[0-9a-f]{64}$')
SAFE = re.compile(r'^(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$')


def checked_dir(path, base):
    if not path.is_absolute() or path.resolve() != path or not path.is_relative_to(base):
        raise ValueError('Path is outside its allowed root or contains a symlink')
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError('Directory must be owned by the current user')


def open_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
        os.close(fd)
        raise ValueError('Unsafe regular file')
    return os.fdopen(fd, 'rb')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def copy_output(repo, source, input_id):
    if not HEX.fullmatch(input_id):
        raise ValueError('Invalid input ID')
    checked_dir(repo, WORKTREES)
    checked_dir(source, SOURCES)
    actual = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--show-toplevel'], text=True).strip()
    if actual != str(repo):
        raise ValueError('Destination is not the exact worktree root')
    parent = repo / 'reference-static' / input_id
    checked_dir(parent, repo / 'reference-static')
    inventory = parent / 'integrity.json'
    with open_regular(inventory) as f:
        inventory_bytes = f.read(4 * 1024 * 1024 + 1)
    if len(inventory_bytes) > 4 * 1024 * 1024 or hashlib.sha256(inventory_bytes).hexdigest() != input_id:
        raise ValueError('Inventory hash does not match input ID')
    dest = parent / 'output'
    if dest.exists() or dest.is_symlink():
        raise ValueError('Destination already exists')
    status = subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=all'], text=True)
    allowed = {f'?? reference-static/{input_id}/integrity.json', f'?? reference-static/{input_id}/custody.json'}
    if any(line not in allowed for line in status.splitlines()):
        raise ValueError('Worktree has unrelated changes')
    inv = json.loads(inventory_bytes)
    entries = inv.get('files')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Missing file inventory')
    expected = {}
    for e in entries:
        if not isinstance(e, dict) or set(e) != {'path', 'bytes', 'sha256'} or not isinstance(e['path'], str) or not e['path'].startswith('output/'):
            raise ValueError('Invalid inventory entry')
        name = e['path'][7:]
        if not SAFE.fullmatch(name) or any(x in ('.', '..') for x in name.split('/')) or name in expected or type(e['bytes']) is not int or not 0 <= e['bytes'] <= 25 * 1024 * 1024 or not isinstance(e['sha256'], str) or not HEX.fullmatch(e['sha256']):
            raise ValueError('Invalid inventory entry')
        expected[name] = e
    found = set()
    for root, dirs, files in os.walk(source, followlinks=False):
        directory = Path(root)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid():
            raise ValueError('Unowned or linked source directory')
        for name in dirs:
            if (directory / name).is_symlink():
                raise ValueError('Source symlink refused')
        for name in files:
            f = directory / name
            info = f.lstat()
            key = f.relative_to(source).as_posix()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or key not in expected:
                raise ValueError('Unsafe or unexpected source file')
            with open_regular(f) as verified:
                checked = verified.read(expected[key]['bytes'] + 1)
            if len(checked) != expected[key]['bytes'] or hashlib.sha256(checked).hexdigest() != expected[key]['sha256']:
                raise ValueError('Source file differs from inventory')
            found.add(key)
    if found != set(expected):
        raise ValueError('Source inventory incomplete')
    dest.mkdir(mode=0o700)
    for name, e in expected.items():
        src, dst = source / name, dest / name
        dst.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # copyfile does not preserve the producer's read-only directory modes.
        with open_regular(src) as inp, dst.open('xb') as out:
            info = os.fstat(inp.fileno())
            if info.st_size != e['bytes']:
                raise ValueError('Source size changed; preserve partial destination')
            data = inp.read(e['bytes'] + 1)
            if len(data) != e['bytes'] or hashlib.sha256(data).hexdigest() != e['sha256']:
                raise ValueError('Source changed; preserve partial destination')
            out.write(data)
        os.chmod(dst, 0o755 if info.st_mode & 0o111 else 0o644)
        if dst.stat().st_size != e['bytes'] or digest(dst) != e['sha256']:
            raise ValueError('Copied file differs from inventory; preserve partial destination')
    print(f'Copied and verified {len(expected)} files into {dest}')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', required=True, type=Path)
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--input-id', required=True)
    a = p.parse_args()
    copy_output(a.repo, a.source, a.input_id)


if __name__ == '__main__':
    main()
