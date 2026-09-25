import base64
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import subprocess

BASE = 'f2e3cbd48483c1ab8a713a71a2af4e326981261c'
DIGEST = 'da07f3c427999e34393c2f2ef9bea32ef167582a02e855f4e1ba90c39088fd11'
DESTINATION = 'refs/heads/build/studio-assembled-20260925'

def git(*args, data=None, env=None):
    return subprocess.run(['git', *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, env=env).stdout

def digest(value):
    return hashlib.sha256(value).hexdigest()

packed = base64.b64decode(''.join(Path(f'.studio-transfer/part-{i}.txt').read_text().strip() for i in range(6)), validate=True)
assert digest(packed) == DIGEST, 'Transport hash mismatch'
payload = json.loads(lzma.decompress(packed))
assert payload['base'] == BASE and len(payload['changes']) == 36
index = str(Path(os.environ['RUNNER_TEMP']) / 'studio-verified-index')
env = dict(os.environ, GIT_INDEX_FILE=index)
git('read-tree', BASE, env=env)
seen = set()
report = {'base': BASE, 'transportSha256': DIGEST, 'files': []}
for item in payload['changes']:
    path = item['path']
    p = PurePosixPath(path)
    assert path not in seen and not p.is_absolute() and '..' not in p.parts
    assert path == 'DESIGN.md' or p.parts[0] in {'app', 'components', 'lib', 'public', 'qa', 'docs'}
    seen.add(path)
    before = None
    probe = subprocess.run(['git', 'cat-file', '-e', f'{BASE}:{path}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if probe.returncode == 0:
        before = git('show', f'{BASE}:{path}')
    assert (digest(before) if before is not None else None) == item['before'], f'Preimage mismatch: {path}'
    if item['sha256'] is None:
        assert before is not None
        git('update-index', '--force-remove', '--', path, env=env)
        report['files'].append({'path': path, 'deleted': True, 'before': item['before']})
        continue
    if item['base64'] is not None:
        after = base64.b64decode(item['base64'], validate=True)
    else:
        lines = (before or b'').decode('utf-8').splitlines(keepends=True)
        edits = item['edits']
        last = len(lines)
        for edit in reversed(edits):
            start, end = edit['start'], edit['end']
            assert 0 <= start <= end <= last
            lines[start:end] = edit['text'].splitlines(keepends=True)
            last = start
        after = ''.join(lines).encode('utf-8')
    assert digest(after) == item['sha256'], f'Postimage mismatch: {path}'
    blob = git('hash-object', '-w', '--stdin', data=after).decode().strip()
    git('update-index', '--add', '--cacheinfo', f'100644,{blob},{path}', env=env)
    report['files'].append({'path': path, 'before': item['before'], 'sha256': digest(after), 'blob': blob})
tree = git('write-tree', env=env).decode().strip()
paths = git('ls-tree', '-r', '--name-only', tree).decode().splitlines()
assert not any(p.startswith('.studio-transfer/') or p.endswith('assemble-studio-source.yml') for p in paths)
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
commit = git('commit-tree', tree, '-p', BASE, '-m', 'Assemble hash-verified studio identity and live-edge transcript source').decode().strip()
git('push', 'origin', f'{commit}:{DESTINATION}')
report.update(tree=tree, commit=commit, destination=DESTINATION, workflowFilesChanged=False)
Path('studio-assembly-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'tree': tree, 'commit': commit, 'verifiedFiles': len(seen)}))
