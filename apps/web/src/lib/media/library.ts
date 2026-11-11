/** Build-time media resolution. Change named placements in media-library.json. */
import type { ImageMetadata } from 'astro';
import raw from '../../data/media-library.json';
interface Asset {kind:string;label:string;source:string|null;profile:string;outputs:string[];alt?:string;}
interface Library {assets:Record<string,Asset>;placements:Record<string,string>;}
const library = raw as Library;
const photos = import.meta.glob<{default:ImageMetadata}>('../../assets/photos/*.jpg',{eager:true});
export function mediaAsset(id:string):Asset {
  const asset=library.assets[id];
  if(!asset)throw new Error(`Unknown media asset: ${id}. Check src/data/media-library.json.`);
  return asset;
}
export function placement(name:string):Asset {
  const id=library.placements[name];
  if(!id)throw new Error(`Unknown media placement: ${name}`);
  return mediaAsset(id);
}
export function imageAsset(id:string):ImageMetadata {
  const asset=mediaAsset(id);
  const file=asset.outputs.find(p=>p.startsWith('apps/web/src/assets/photos/'));
  const module=file&&photos[`../../assets/photos/${file.split('/').pop()}`];
  if(!module)throw new Error(`Missing prepared image for ${id}; run py scripts/media/media.py build ${id}`);
  return module.default;
}
export function photoFor(name:string) {
  const id=library.placements[name];
  return {image:imageAsset(id),alt:mediaAsset(id).alt||''};
}
export function publicFile(name:string):string {
  const file=placement(name).outputs.find(p=>p.startsWith('apps/web/public/'));
  if(!file)throw new Error(`No public output for ${name}`);
  return '/'+file.replace('apps/web/public/','');
}
export function heroSources() {
  return placement('home.hero.video').outputs.map(file=>({src:'/'+file.replace('apps/web/public/',''),type:file.endsWith('.webm')?'video/webm':'video/mp4',size:file.includes('-sm.')?'sm':'lg'})).sort((a,b)=>a.type===b.type?0:a.type==='video/webm'?-1:1);
}
