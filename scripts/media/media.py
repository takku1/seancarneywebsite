"""SCE media library: organize, inspect, replace, prepare and verify local media.

Run `py scripts/media/media.py --help`. Originals are never overwritten or deleted.
"""
from pathlib import Path
from contextlib import contextmanager
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'apps/web/src/data/media-library.json'
RES = ROOT / 'resources'
CACHE = RES / '.media-build-cache.json'
ALLOWED = [ROOT / p for p in ['apps/web/src/assets/photos','apps/web/src/assets/covers','apps/web/public/media','apps/web/public/downloads']]

def inside(root, value):
    root=root.resolve(); path=(root / value).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f'Path must stay inside {root}: {value}')
    return path

def output_path(value):
    path=inside(ROOT,value)
    if not any(path.is_relative_to(p.resolve()) for p in ALLOWED):
        raise ValueError(f'Output outside managed media folders: {value}')
    return path

def read_json(path, fallback=None):
    if not path.exists() and fallback is not None:return fallback
    return json.loads(path.read_text(encoding='utf-8'))

def write_json(path, value):
    text=json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    if path.exists() and path.read_text(encoding='utf-8')==text:return
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.writing')
    temp.write_text(text,encoding='utf-8');temp.replace(path)

def validate(catalog, sources=True):
    if catalog.get('version')!=1:raise ValueError('Unsupported media catalog version')
    seen=set()
    for key,a in catalog['assets'].items():
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',key):raise ValueError(f'Invalid asset ID: {key}')
        if a['profile'] not in ('legacy','photo','portrait','poster','hero','film','audio','copy'):raise ValueError(f'Unknown profile: {key}')
        profiles={'image':('legacy','photo','portrait','poster'),'video':('hero','film'),'audio':('audio',),'document':('copy',)}
        if a.get('kind') not in profiles or a['profile'] not in profiles[a['kind']]:raise ValueError(f'Media kind/profile mismatch: {key}')
        if not a.get('outputs'):raise ValueError(f'No outputs: {key}')
        if a['profile']=='hero':
            files=a['outputs']
            if len(files)!=4 or sum(p.endswith('.mp4') for p in files)!=2 or sum(p.endswith('.webm') for p in files)!=2 or sum('-sm.' in p for p in files)!=2:raise ValueError(f'Hero requires desktop/mobile MP4 and WebM outputs: {key}')
        for out in a['outputs']:
            output_path(out)
            if out in seen:raise ValueError(f'Duplicate output: {out}')
            seen.add(out)
        if a.get('source'):
            source=inside(RES,a['source'])
            if sources and not source.is_file():raise ValueError(f'Missing source for {key}: {source}')
        elif a['profile']!='legacy':raise ValueError(f'No source for {key}')
        if a.get('start',0)<0 or a.get('duration',1)<=0 or a.get('posterTime',0)<0:raise ValueError(f'Invalid clip timing: {key}')
    for placement,key in catalog['placements'].items():
        if key not in catalog['assets']:raise ValueError(f'Unknown placement asset: {placement} -> {key}')
        expected='video' if placement.endswith('.video') else 'image'
        if catalog['assets'][key]['kind']!=expected:raise ValueError(f'{placement} requires {"an" if expected=="image" else "a"} {expected} asset')
        if catalog['assets'][key]['kind']=='image' and not catalog['assets'][key].get('alt'):raise ValueError(f'Add alt text for image used at {placement}: {key}')

def signature(a, catalog):
    source=inside(RES,a['source']);s=source.stat()
    recipe={'asset':a,'profile':catalog['profiles'].get(a['profile'],{}),'sourceSize':s.st_size,'sourceMtime':s.st_mtime_ns,'pipeline':1}
    return hashlib.sha256(json.dumps(recipe,sort_keys=True).encode()).hexdigest()

def status(key,a,catalog,cache):
    if any(not output_path(p).is_file() for p in a['outputs']):return 'MISSING OUTPUT'
    if not a.get('source'):return 'LEGACY / SOURCE UNMAPPED'
    if not inside(RES,a['source']).is_file():return 'MISSING SOURCE'
    if cache.get(key)!=signature(a,catalog):return 'BUILD NEEDED'
    return 'ready'

def organize(catalog, apply=False):
    old=RES/'drive-manifest.json';new=inside(ROOT,catalog['archiveManifest'])
    if not old.exists():
        if new.exists():print('Drive archive already organized.');return
        raise ValueError('No original Drive manifest found')
    files=read_json(old);moves=[]
    for f in files:
        src=inside(RES,f['path']);dest=inside(new.parent,f['path'])
        # Both resolved paths are inside the intended resources workspace before any move.
        inside(RES,src);inside(RES,dest)
        if not src.is_file() or src.stat().st_size!=int(f['size']):raise ValueError(f'Incomplete archive source: {src}')
        if dest.exists():raise ValueError(f'Destination exists; refusing overwrite: {dest}')
        moves.append((src,dest))
    brief=RES/'SCE Website.docx';brief_dest=RES/'briefs/SCE Website.docx'
    if brief.exists() and brief_dest.exists():raise ValueError('Both brief locations exist; nothing moved')
    print(f'{"Moving" if apply else "Would move"} {len(moves)} originals into {new.parent.relative_to(ROOT)}')
    if not apply:print('Add --apply to perform the move.');return
    for src,dest in moves:
        dest.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(src),str(dest))
    # Remove only empty archive directories left behind, never recursively.
    parents=sorted({s.parent for s,_ in moves if s.parent!=RES},key=lambda p:len(p.parts),reverse=True)
    for parent in parents:
        if not any(parent.iterdir()):parent.rmdir()
    new.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(old),str(new))
    if brief.exists():brief_dest.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(brief),str(brief_dest))
    (RES/'incoming').mkdir(exist_ok=True)
    print('Original filenames and Drive subfolders preserved; brief moved to resources/briefs.')

@contextmanager
def build_lock():
    RES.mkdir(exist_ok=True);lock=RES/'.media-build.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:raise ValueError('Another media build holds resources/.media-build.lock. If interrupted, verify it has stopped before removing that lock.')
    os.write(fd,str(os.getpid()).encode());os.close(fd)
    try:yield
    finally:lock.unlink(missing_ok=True)

def prepare(key,a,catalog):
    from PIL import Image, ImageOps
    source=inside(RES,a['source']);profile=a['profile'];settings=catalog['profiles'].get(profile,{})
    outputs=[output_path(p) for p in a['outputs']]
    temps=[p.with_name(p.stem+f'.working-{os.getpid()}'+p.suffix) for p in outputs]
    for p in temps:p.parent.mkdir(parents=True,exist_ok=True)
    def ff(src,dest,*args):
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(src),*map(str,args),str(dest)],check=True)
    try:
        if profile in ('photo','portrait'):
            with Image.open(source) as raw:
                im=ImageOps.exif_transpose(raw).convert('RGB');width=settings.get('width',1800);im.thumbnail((width,width*2))
                for temp in temps:im.save(temp,quality=settings.get('quality',88),optimize=True)
        elif profile=='poster':
            for temp in temps:ff(source,temp,'-ss',a.get('posterTime',0),'-frames:v',1,'-update',1,'-vf',f'scale=min({settings.get("width",1920)}\\,iw):-2','-q:v',2)
        elif profile=='hero':
            for size in ('desktop','mobile'):
                small=size=='mobile';mp4=next(t for t,p in zip(temps,outputs) if p.suffix=='.mp4' and ('-sm' in p.stem)==small);webm=next(t for t,p in zip(temps,outputs) if p.suffix=='.webm' and ('-sm' in p.stem)==small)
                width=settings[size+'Width'];bitrate=settings[size+'Bitrate']
                ff(source,mp4,'-ss',a.get('start',0),'-t',a.get('duration',40),'-an','-vf',f'scale={width}:-2,fps={settings.get("fps",24)}','-c:v','libx264','-preset','fast','-b:v',bitrate,'-maxrate',bitrate,'-bufsize','1400k','-pix_fmt','yuv420p','-movflags','+faststart')
                ff(mp4,webm,'-an','-c:v','libvpx-vp9','-b:v',bitrate,'-crf',38,'-deadline','realtime','-cpu-used',6)
        elif profile=='film':
            for temp in temps:ff(source,temp,'-vf',f'scale={settings["width"]}:-2','-c:v','libx264','-preset','fast','-b:v',settings['videoBitrate'],'-maxrate',settings['maxVideoBitrate'],'-bufsize','1700k','-c:a','aac','-b:a',settings['audioBitrate'],'-pix_fmt','yuv420p','-movflags','+faststart')
        elif profile=='audio':
            for temp in temps:ff(source,temp,'-vn','-c:a','libmp3lame','-b:a',settings['bitrate'],'-ar',settings['sampleRate'],'-map_metadata','-1')
        elif profile=='copy':
            for temp in temps:shutil.copy2(source,temp)
        else:raise ValueError(f'Cannot prepare profile {profile}')
        for temp in temps:
            if not temp.is_file() or not temp.stat().st_size:raise ValueError(f'Empty generated file: {temp}')
            if temp.stat().st_size>25*1024*1024:raise ValueError(f'{key}: generated file exceeds 25 MiB; adjust its compression profile')
        # Promote only after every derivative has been created successfully.
        for temp,dest in zip(temps,outputs):temp.replace(dest)
    finally:
        for temp in temps:temp.unlink(missing_ok=True)

def sync_audio(catalog):
    tracks=[]
    for key,a in sorted(catalog['assets'].items(),key=lambda item:item[1].get('order',1000)):
        if a['kind']=='audio':tracks.append({'id':a['trackId'],'title':a['label'],'artist':a['artist'],'src':'/'+a['outputs'][0].removeprefix('apps/web/public/')})
    write_json(ROOT/'apps/web/src/data/audio.json',tracks)

def build(catalog,ids,force=False):
    validate(catalog,sources=False);cache=read_json(CACHE,{})
    if ids:
        unknown=set(ids)-set(catalog['assets'])
        if unknown:raise ValueError('Unknown asset IDs: '+', '.join(sorted(unknown)))
    selected=ids or list(catalog['assets']);count=0
    with build_lock():
        for key in selected:
            a=catalog['assets'][key]
            if a['profile']=='legacy':continue
            sig=signature(a,catalog)
            if not force and cache.get(key)==sig and all(output_path(p).exists() for p in a['outputs']):continue
            print('Preparing '+key,flush=True);prepare(key,a,catalog);cache[key]=sig;write_json(CACHE,cache);count+=1
        sync_audio(catalog)
    print(f'Prepared {count} assets; unchanged files skipped. Audio metadata synchronized.')

def replace(catalog,key,file,alt=None):
    if key not in catalog['assets']:raise ValueError(f'Unknown asset ID: {key}')
    source=Path(file).resolve()
    if not source.is_file():raise ValueError(f'Not a file: {source}')
    digest=hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    target=inside(RES,f'incoming/{key}/{digest.hexdigest()[:12]}{source.suffix.lower()}')
    if source!=target:
        target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copy2(source,target)
    a=catalog['assets'][key];a['source']=target.relative_to(RES).as_posix()
    if a['kind']=='image' and (a['profile']=='legacy' or (a['profile']=='poster' and source.suffix.lower() in ('.jpg','.jpeg','.png','.webp'))):a['profile']='photo'
    if alt is not None:a['alt']=alt
    validate(catalog,sources=False);write_json(CATALOG,catalog)
    print(f'Source set for {key}; originals retained. Run: py scripts/media/media.py build {key}')
    print('Review the image alt text and every placement before publishing.')

def usage(catalog,key,texts):
    a=catalog['assets'][key]
    slots=[p for p,k in catalog['placements'].items() if k==key]
    needles=slots+[Path(p).name for p in a['outputs']]
    files=[name for name,text in texts.items() if any(n in text for n in needles)]
    return slots,files

def source_texts():
    return {p.relative_to(ROOT).as_posix():p.read_text(encoding='utf-8') for p in (ROOT/'apps/web/src').rglob('*') if p.is_file() and p.suffix in ('.astro','.ts','.json') and p!=CATALOG}

def report(catalog):
    cache=read_json(CACHE,{});rows=[];texts=source_texts()
    for key,a in catalog['assets'].items():
        slots,files=usage(catalog,key,texts)
        locations=', '.join(slots) or 'Existing content references / available image'
        path=output_path(a['outputs'][0]);relative='../'+path.relative_to(ROOT).as_posix();url=quote(relative,safe='/')
        if a['kind']=='image':preview=f'<img src="{url}" alt="{html.escape(a.get("alt",key),quote=True)}" loading="lazy">'
        elif a['kind'] in ('audio','video'):preview=f'<{a["kind"]} controls preload="none" src="{url}"></{a["kind"]}>'
        else:preview=f'<a href="{url}">Open download</a>'
        rows.append(f'<article><div class="preview">{preview}</div><h2>{html.escape(a["label"])}</h2><code>{key}</code><p>{html.escape(status(key,a,catalog,cache))}</p><p>{html.escape(locations)}</p><details><summary>Source, outputs and usage</summary><p>{html.escape(a.get("source") or "Legacy source not mapped")}</p><pre>{html.escape(chr(10).join(a["outputs"]+files))}</pre></details></article>')
    archive=[];manifest=inside(ROOT,catalog['archiveManifest'])
    if manifest.exists():
        prefix=manifest.parent.relative_to(RES).as_posix()+'/'
        for f in read_json(manifest):
            active=', '.join(k for k,a in catalog['assets'].items() if a.get('source')==prefix+f['path']) or 'Archived / not selected'
            archive.append(f'<tr><td><a href="{quote(prefix+f["path"],safe="/")}">{html.escape(f["path"])}</a></td><td>{int(f["size"])/1024/1024:.2f} MiB</td><td>{html.escape(active)}</td></tr>')
    text='<!doctype html><html lang="en"><meta charset="utf-8"><title>SCE media library — local inventory</title><style>body{margin:3rem;font:16px system-ui;background:#f3efe7;color:#24201b}h1{font:48px Georgia}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:2rem}article{border-top:1px solid #bbb;padding-top:1rem;min-width:0}h2{font:26px Georgia}img,video{width:100%;height:220px;object-fit:contain}audio{width:100%}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}input{padding:1rem;margin-bottom:2rem;width:min(90%,35rem)}[hidden]{display:none}</style><h1>SCE media library</h1><p>Local working inventory. This page is not part of the public website. Replace sources with the media command, not by editing this generated report.</p><input type="search" aria-label="Filter media" placeholder="Find an asset, placement or filename"><main>'+''.join(rows)+'</main><script>document.querySelector("input").addEventListener("input",e=>{const q=e.target.value.toLowerCase();for(const a of document.querySelectorAll("article"))a.hidden=!a.textContent.toLowerCase().includes(q);});</script></html>'
    if archive:text=text.replace('</html>','<h2>Original Drive archive</h2><p>Preserved source files; this inventory does not publish them.</p><table><thead><tr><th>Original file</th><th>Size</th><th>Selected as source</th></tr></thead><tbody>'+''.join(archive)+'</tbody></table></html>')
    path=RES/'media-index.html';path.write_text(text,encoding='utf-8');print(path)

def check(catalog, outputs_only=False):
    validate(catalog,sources=not outputs_only);errors=[]
    cache=read_json(CACHE,{})
    for key,a in catalog['assets'].items():
        for value in a['outputs']:
            p=output_path(value)
            if not p.is_file():errors.append(f'{key}: missing {value}')
            elif p.stat().st_size>25*1024*1024:errors.append(f'{key}: output exceeds 25 MiB')
        if not outputs_only and a.get('source') and cache.get(key)!=signature(a,catalog):errors.append(f'{key}: source or recipe changed; run media.py build')
    expected=[a['trackId'] for a in catalog['assets'].values() if a['kind']=='audio']
    if set(expected)!={t['id'] for t in read_json(ROOT/'apps/web/src/data/audio.json')}:errors.append('audio.json is out of sync; run media.py build')
    if errors:raise ValueError('\n'.join(errors))
    print(f'Catalog OK: {len(catalog["assets"])} assets, {len(catalog["placements"])} placements; source/output paths and sizes checked.')

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('organize',help='Preview moving the original Drive archive into originals/');p.add_argument('--apply',action='store_true')
    sub.add_parser('list',help='List IDs, preparation state and source paths')
    p=sub.add_parser('check',help='Validate catalog, paths, source files and prepared outputs');p.add_argument('--outputs-only',action='store_true',help='For CI/checkouts without the private source archive')
    sub.add_parser('report',help='Generate a private, searchable visual inventory')
    p=sub.add_parser('info',help='Find an asset and its named placements');p.add_argument('id')
    p=sub.add_parser('build',help='Prepare changed assets, or selected IDs');p.add_argument('ids',nargs='*');p.add_argument('--force',action='store_true')
    p=sub.add_parser('replace',help='Copy a replacement into incoming/ and update the catalog');p.add_argument('id');p.add_argument('file');p.add_argument('--alt')
    args=parser.parse_args();catalog=read_json(CATALOG)
    if args.command=='organize':organize(catalog,args.apply)
    elif args.command=='build':build(catalog,args.ids,args.force)
    elif args.command=='replace':replace(catalog,args.id,args.file,args.alt)
    elif args.command=='check':check(catalog,args.outputs_only)
    elif args.command=='report':validate(catalog,sources=False);report(catalog)
    elif args.command=='info':
        if args.id not in catalog['assets']:raise ValueError('Unknown asset ID')
        print(json.dumps(catalog['assets'][args.id],ensure_ascii=False,indent=2));slots,files=usage(catalog,args.id,source_texts());print('Placements: '+', '.join(slots));print('Referenced by:\n'+'\n'.join(files))
    elif args.command=='list':
        cache=read_json(CACHE,{})
        for key,a in catalog['assets'].items():print(f'{key:32} {status(key,a,catalog,cache):26} {a.get("source") or "legacy image"}')

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:main()
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:print('Media error: '+str(e),file=sys.stderr);raise SystemExit(1)
