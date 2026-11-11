/** Repertoire-only suggestions and a per-tab planning list; never a booking promise. */
export interface Song { id:string; title:string; artist:string; genre:string; }
export interface Preferences { event:string; mood:string; vibe:string; genre:string; }
export interface MusicPlan { must:string[]; avoid:string[]; }
interface Group { id:string; genre:string; songs:{title:string;artist:string}[]; }
export const catalogFrom = (groups:Group[]):Song[] => groups.flatMap(g=>g.songs.map((s,i)=>({...s,id:`${g.id}:${i}`,genre:g.id})));
const romantic = /at last|lover$|ordinary|perfect$|can't help|all of me|best part|god only knows|wonderful tonight|how long will i love|bless the broken|time in a bottle|thinking out loud|yellow$/i;
const party = /september|uptown funk|24k magic|dancing queen|shut up and dance|can't stop|i wanna|i want it that|everybody|mr. brightside|i gotta feeling|shake it off|levitating|espresso|superstition|we are family/i;
export function suggestSongs(songs:Song[], p:Preferences, avoid:string[] = [], limit=30):Song[] {
  const blocked=new Set(avoid);
  const identity=(s:Song)=>`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
  const blockedSongs=new Set(songs.filter(s=>blocked.has(s.id)).map(identity));
  const ranked=songs.filter(s=>!blockedSongs.has(identity(s))).map((s,index)=>{
    let score=0;
    if(p.genre!=='all' && s.genre===p.genre)score+=20;
    if(p.event==='cocktail' && /jazz|soul|beach|acoustic/.test(s.genre))score+=5;
    if(p.event==='wedding' && romantic.test(s.title))score+=6;
    if(p.event==='corporate' && /pop|funk|soul/.test(s.genre))score+=4;
    if(p.mood==='intimate' && romantic.test(s.title))score+=8;
    if(p.mood==='lively' && party.test(s.title))score+=8;
    if(p.vibe==='timeless' && /jazz|motown|classic|beach/.test(s.genre))score+=4;
    if(p.vibe==='modern' && /pop|alt/.test(s.genre))score+=4;
    if(p.vibe==='soulful' && /soul|blues|jazz/.test(s.genre))score+=4;
    return {song:s,score,index};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
  // Same song/artist can appear in several source genres; suggestions stay unique.
  const seen=new Set<string>();
  return ranked.filter(x=>{const key=`${x.song.title.toLowerCase()}|${x.song.artist.toLowerCase()}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit).map(x=>x.song);
}
export function readPlan(raw:string|null, songs:Song[]):MusicPlan {
  const valid=new Set(songs.map(s=>s.id));
  try {
    const p=JSON.parse(raw||'{}');
    const clean=(a:unknown):string[]=>Array.isArray(a)?[...new Set(a.filter((x):x is string=>typeof x==='string'&&valid.has(x)))].slice(0,12):[];
    const avoid=clean(p.avoid);
    return {avoid,must:clean(p.must).filter(x=>!avoid.includes(x))};
  }catch{return {must:[],avoid:[]};}
}
export function chooseSong(plan:MusicPlan,id:string,kind:'must'|'avoid'):MusicPlan {
  const other=kind==='must'?'avoid':'must';
  const selected=plan[kind].includes(id);
  if(!selected && plan[kind].length>=12)return plan;
  return {...plan,[kind]:selected?plan[kind].filter(x=>x!==id):[...plan[kind],id],[other]:plan[other].filter(x=>x!==id)};
}
export function planMessage(plan:MusicPlan,songs:Song[]):string {
  const names=(ids:string[])=>ids.map(id=>songs.find(s=>s.id===id)).filter((s):s is Song=>!!s).map(s=>`${s.title}${s.artist?` (${s.artist})`:''}`).join('; ');
  return [plan.must.length?`Songs we love: ${names(plan.must)}`:'',plan.avoid.length?`Do Not Play: ${names(plan.avoid)}`:''].filter(Boolean).join('\n');
}
