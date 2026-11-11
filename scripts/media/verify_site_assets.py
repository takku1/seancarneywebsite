"""Check built local links/media and the optional local Drive archive."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json
import sys
sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'apps/web/dist/client'
errors = []
references = 0

class References(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.page = page
    def handle_starttag(self, tag, attrs):
        global references
        for key, value in attrs:
            if key not in ('href', 'src', 'poster', 'data-media-src', 'data-src') or not value:
                continue
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc or not parsed.path.startswith('/') or parsed.path.startswith('/api/'):
                continue
            target = DIST / unquote(parsed.path).lstrip('/')
            references += 1
            if not any(p.is_file() for p in (target, target.with_suffix('.html'), target / 'index.html')):
                errors.append(f'{self.page.relative_to(DIST)}: missing {value}')

for page in DIST.rglob('*.html'):
    References(page).feed(page.read_text(encoding='utf-8'))

for asset in (DIST / 'media').rglob('*'):
    if asset.is_file() and asset.stat().st_size > 25 * 1024 * 1024:
        errors.append(f'Cloudflare asset exceeds 25 MiB: {asset.name}')

manifest = ROOT / 'resources/originals/drive-2026-11-10/drive-manifest.json'
if manifest.exists():
    sources = json.loads(manifest.read_text(encoding='utf-8'))
    for source in sources:
        p = manifest.parent / source['path']
        if not p.is_file() or p.stat().st_size != int(source['size']):
            errors.append(f'Drive archive missing or incomplete: {source["path"]}')
    print(f'Drive archive: {len(sources)} source files checked')

print(f'Built site: {references} local references checked; all media checked against 25 MiB limit')
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print('All asset and link checks passed.')
