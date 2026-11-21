#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_copy', pathlib.Path(__file__).with_name('prepare-release-output.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class ReleaseCopyTest(unittest.TestCase):
    def setUp(self):
        self.src_root = pathlib.Path(tempfile.mkdtemp(prefix='delivery-copy-test-', dir=module.SOURCES))
        self.work_parent = pathlib.Path(tempfile.mkdtemp(prefix='delivery-copy-test-', dir=module.WORKTREES))
        self.main = self.src_root / 'main'
        self.main.mkdir()
        run('git', 'init', '-q', cwd=self.main)
        run('git', 'config', 'user.name', 'Test', cwd=self.main)
        run('git', 'config', 'user.email', 'test@example.invalid', cwd=self.main)
        (self.main / 'README').write_text('fixture\n')
        run('git', 'add', 'README', cwd=self.main)
        run('git', 'commit', '-qm', 'fixture', cwd=self.main)
        self.repo = self.work_parent / 'worktree'
        run('git', 'worktree', 'add', '-q', '--detach', str(self.repo), 'HEAD', cwd=self.main)
        self.source = self.src_root / 'source'
        (self.source / 'data').mkdir(parents=True)
        (self.source / 'data' / 'fixture.bin').write_bytes(b'approved synthetic bytes')
        self.make_inventory()

    def make_inventory(self):
        f = self.source / 'data' / 'fixture.bin'
        value = {'files': [{'path': 'output/data/fixture.bin', 'bytes': f.stat().st_size, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}]}
        data = (json.dumps(value, indent=2) + '\n').encode()
        self.ident = hashlib.sha256(data).hexdigest()
        self.parent = self.repo / 'reference-static' / self.ident
        self.parent.mkdir(parents=True)
        (self.parent / 'integrity.json').write_bytes(data)

    def tearDown(self):
        for root, dirs, _ in os.walk(self.src_root):
            os.chmod(root, 0o700)
        for root, dirs, _ in os.walk(self.work_parent):
            os.chmod(root, 0o700)
        shutil.rmtree(self.work_parent)
        shutil.rmtree(self.src_root)

    def test_readonly_producer_copy_and_normal_worktree_removal(self):
        os.chmod(self.source / 'data', 0o500)
        os.chmod(self.source, 0o500)
        module.copy_output(self.repo, self.source, self.ident)
        out = self.parent / 'output' / 'data' / 'fixture.bin'
        self.assertEqual(out.read_bytes(), b'approved synthetic bytes')
        self.assertTrue((self.parent / 'output' / 'data').stat().st_mode & 0o200)
        self.assertFalse(self.source.stat().st_mode & 0o200)
        run('git', 'add', 'reference-static', cwd=self.repo)
        run('git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'copy', cwd=self.repo)
        run('git', 'worktree', 'remove', str(self.repo), cwd=self.main)
        self.assertFalse(self.repo.exists())
        self.assertTrue((self.source / 'data' / 'fixture.bin').exists())

    def test_dirty_worktree_refused(self):
        (self.repo / 'unrelated').write_text('preserve')
        with self.assertRaisesRegex(ValueError, 'unrelated changes'):
            module.copy_output(self.repo, self.source, self.ident)
        self.assertFalse((self.parent / 'output').exists())

    def test_symlink_and_hardlink_refused(self):
        (self.source / 'link').symlink_to(self.source / 'data' / 'fixture.bin')
        with self.assertRaisesRegex(ValueError, 'Unsafe or unexpected'):
            module.copy_output(self.repo, self.source, self.ident)
        (self.source / 'link').unlink()
        os.link(self.source / 'data' / 'fixture.bin', self.src_root / 'hardlink')
        with self.assertRaisesRegex(ValueError, 'Unsafe or unexpected'):
            module.copy_output(self.repo, self.source, self.ident)
        self.assertFalse((self.parent / 'output').exists())

    def test_source_swap_before_copy_is_refused(self):
        target = self.source / 'data' / 'fixture.bin'
        original_open = module.open_regular
        count = 0

        def swap_on_copy(path):
            nonlocal count
            if path == target:
                count += 1
                if count == 2:
                    target.unlink()
                    target.symlink_to(self.src_root / 'elsewhere')
            return original_open(path)

        with patch.object(module, 'open_regular', side_effect=swap_on_copy):
            with self.assertRaises(OSError):
                module.copy_output(self.repo, self.source, self.ident)
        self.assertEqual(count, 2)
        self.assertTrue((self.parent / 'output').exists())

    def test_existing_destination_and_source_mismatch_refused(self):
        (self.parent / 'output').mkdir()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            module.copy_output(self.repo, self.source, self.ident)
        (self.parent / 'output').rmdir()
        (self.source / 'data' / 'fixture.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'differs from inventory'):
            module.copy_output(self.repo, self.source, self.ident)
        self.assertFalse((self.parent / 'output').exists())


if __name__ == '__main__':
    unittest.main()
