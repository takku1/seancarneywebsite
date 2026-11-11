import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const groups = JSON.parse(await readFile('src/data/songbook.json','utf8'));
const html = await readFile('src/pages/repertoire.astro','utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const input = new EventTarget(); input.value = '';
const select = new EventTarget(); select.value = 'all';
const count = {textContent:''}; const empty = {hidden:true};
const nodes = groups.map(g => ({
  dataset:{songGroup:g.id}, hidden:false,
  songs:g.songs.map(s => ({dataset:{search:`${s.title} ${s.artist}`},hidden:false})),
  querySelectorAll() {return this.songs;},
}));
const root = { querySelector:s => ({'[data-song-search]':input,'[data-song-genre]':select,'[data-song-count]':count,'[data-song-empty]':empty})[s], querySelectorAll:() => nodes };
globalThis.document = {querySelector:() => root};
const built = await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',plugins:[{name:'lifecycle',setup(b){b.onResolve({filter:/lifecycle/},()=>({path:'setup',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const onPage = (setup) => setup();'}));}}]});
await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
function update(text='',genre='all') {input.value=text;select.value=genre;input.dispatchEvent(new Event('input'));}
const visible = () => nodes.flatMap(g=>g.songs).filter(s=>!s.hidden);
test('the full supplied repertoire is visible and restores after filtering',()=>{update();assert.equal(visible().length,192);assert.equal(empty.hidden,true);});
test('song and artist search combine and ignore accents',()=>{update('feeling buble');assert.equal(visible().length,1);assert.match(visible()[0].dataset.search,/Feeling Good/);});
test('genre and text filters combine and report an empty result',()=>{update('teddy','country');assert.equal(visible().length,0);assert.equal(empty.hidden,false);assert.equal(count.textContent,'0 songs found');});
test('clearing filters restores all nine groups',()=>{update();assert.equal(visible().length,192);assert.equal(nodes.filter(g=>!g.hidden).length,9);});
