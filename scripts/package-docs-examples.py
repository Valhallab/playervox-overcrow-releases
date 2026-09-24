"""Build deterministic source ZIPs, checking every manifest hash before writing."""
from pathlib import Path
from hashlib import sha256
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
references = ('session', 'clock', 'performance', 'fps', 'stopwatch', 'media', 'notes', 'score', 'rating', 'reviews', 'journal', 'twitch')
examples = ('blank', 'counter', 'checklist', 'warframe-market') + references
for name in examples:
    source = root / ('widgets/warframe-market' if name == 'warframe-market' else f'content/references/{name}' if name in references else f'content/templates/{name}')
    manifest = json.loads((source / 'manifest.json').read_text())
    if name == 'warframe-market':
        files = {path: (source / path).read_bytes() for path in manifest['files']}
    else:
        files = {path.relative_to(source).as_posix(): path.read_bytes() for path in sorted(source.rglob('*')) if path.is_file() and path.name != 'manifest.json'}
        if name in references:
            common = root / 'content/references/common'
            files.update({path.relative_to(common).as_posix(): path.read_bytes() for path in sorted(common.rglob('*')) if path.is_file()})
        for asset in ('overcrow.js', 'overcrow.d.ts', 'LICENSE'):
            files[asset] = (root / 'content/sdk' / asset).read_bytes()
        manifest['files'] = {path: {'sha256': sha256(data).hexdigest(), 'bytes': len(data)} for path, data in sorted(files.items())}
    for path, metadata in manifest['files'].items():
        assert sha256(files[path]).hexdigest() == metadata['sha256'], f'{name}/{path}: hash mismatch'
        assert len(files[path]) == metadata['bytes'], f'{name}/{path}: size mismatch'
    files['manifest.json'] = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    with zipfile.ZipFile(output / f'{name}.zip', 'w', compression=zipfile.ZIP_STORED) as archive:
        for path, data in sorted(files.items()):
            info = zipfile.ZipInfo(f'{name}/{path}', date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
print(f'{len(examples)} source archives built; manifest sizes and SHA-256 verified.')

# A complete portable developer kit, distinct from runtime widget packages.
kit_files = {}
for path in sorted((root / 'tools/creator-kit').rglob('*')):
    if path.is_file():
        kit_files[path.relative_to(root / 'tools/creator-kit').as_posix()] = path.read_bytes()
for name in ('blank', 'counter', 'checklist'):
    for path in sorted((root / 'content/templates' / name).rglob('*')):
        if path.is_file():
            kit_files[f'templates/{name}/' + path.relative_to(root / 'content/templates' / name).as_posix()] = path.read_bytes()
for name in ('common',) + references:
    for path in sorted((root / 'content/references' / name).rglob('*')):
        if path.is_file():
            kit_files[f'references/{name}/' + path.relative_to(root / 'content/references' / name).as_posix()] = path.read_bytes()
for name in ('overcrow.js', 'overcrow.d.ts', 'LICENSE'):
    kit_files[f'sdk/{name}'] = (root / 'content/sdk' / name).read_bytes()
with zipfile.ZipFile(output / 'creator-kit.zip', 'w', compression=zipfile.ZIP_STORED) as archive:
    for name, data in sorted(kit_files.items()):
        info = zipfile.ZipInfo('overcrow-creator-kit/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
print('Portable creator kit built with SDK, templates and license.')
