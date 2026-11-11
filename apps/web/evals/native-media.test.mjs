import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Small DOM double exercises the real player module's session/router contract.
// Browser codecs, rendering and accessibility still require browser QA.
class Node extends EventTarget {
  constructor(tag = 'div') {
    super(); this.tag = tag; this.childNodes = []; this.parent = null; this.dataset = {}; this.hidden = false;
    this.classes = new Set(); this.attrs = new Map(); this.textContent = '';
    this.classList = { add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), toggle: (x,on) => on ? this.classes.add(x) : this.classes.delete(x) };
  }
  get isConnected() { return this.root || this.parent?.isConnected || false; }
  append(...nodes) { for (const n of nodes) { n.remove(); this.childNodes.push(n); n.parent = this; } }
  prepend(...nodes) { for (const n of [...nodes].reverse()) { n.remove(); this.childNodes.unshift(n); n.parent = this; } }
  remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(x => x !== this); this.parent = null; }
  replaceChildren(...nodes) { for (const n of [...this.childNodes]) n.remove(); this.append(...nodes); }
  setAttribute(k,v) { this.attrs.set(k,v); }
  removeAttribute(k) { this.attrs.delete(k); if(k === 'src') this.src = ''; }
  querySelector(selector) { return this.selectors?.[selector] || null; }
  scrollIntoView() {}
}
class Media extends Node {
  constructor(tag) { super(tag); this.paused = true; this.currentTime = 0; this.duration = 120; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
}
class Audio extends Media { constructor() { super('audio'); } }
class Video extends Media { constructor() { super('video'); } }
class Frame extends Node {}
Object.assign(globalThis, { Element: Node, HTMLMediaElement: Media, HTMLAudioElement: Audio, HTMLVideoElement: Video, HTMLIFrameElement: Frame });
const doc = new EventTarget();
const dock = new Node(); dock.root = true;
const slot = new Node(); dock.append(slot);
const title = new Node(); const back = new Node();
dock.selectors = { '[data-dock-slot]': slot, '[data-dock-title]': title, '[data-dock-back]': back };
let tiles = [];
doc.querySelector = s => s === '[data-dock]' ? dock : null;
doc.querySelectorAll = () => tiles;
doc.createElement = t => t === 'audio' ? new Audio() : t === 'video' ? new Video() : new Node(t);
const globalEvents = new EventTarget();
Object.assign(globalThis, {
  document: doc, window: globalThis, location: { pathname: '/repertoire' },
  matchMedia: () => ({matches: true}), requestAnimationFrame: cb => cb(),
  addEventListener: globalEvents.addEventListener.bind(globalEvents), dispatchEvent: globalEvents.dispatchEvent.bind(globalEvents),
  CustomEvent: class extends Event { constructor(t,opts) {super(t);this.detail=opts.detail;} },
  IntersectionObserver: class { observe() {} disconnect() {} },
});
const result = await build({
  entryPoints: ['src/lib/media/player.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'test-boundaries', setup(b) {
    b.onResolve({filter: /analytics\/track|astro:transitions\/client|yt-player/}, args => ({path:args.path, namespace:'test'}));
    b.onLoad({filter: /.*/, namespace:'test'}, () => ({contents:'export const track = () => {}; export const navigate = async () => {}; export const command = () => {}; export const embedUrl = () => ""; export const watchPlayer = () => () => {};'}));
  }}],
});
const player = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function tile(id, type = 'audio') {
  const t = new Node(); t.root = true;
  t.dataset = { mediaId:id, mediaSrc:`/media/${id}.${type === 'audio' ? 'mp3' : 'mp4'}`, mediaType:type, title:id };
  t.append(new Node('thumbnail')); tiles.push(t); return t;
}
afterEach(() => {player.close(); tiles = [];});

test('recordings use one dock session; replacement stops and unloads the old source', () => {
  player.playNative(tile('ordinary'));
  const first = slot.childNodes[0];
  assert.ok(first instanceof Audio); assert.equal(first.paused,false);
  player.playNative(tile('at-last'));
  assert.equal(first.paused,true); assert.equal(first.src,'');
  assert.equal(slot.childNodes.length,1); assert.equal(title.textContent,'at-last');
  player.pause(); assert.equal(slot.childNodes[0].paused,true);
});
test('audio survives a page swap and Back keeps its controls in the dock', async () => {
  const original = tile('ordinary'); player.playNative(original);
  const media = slot.childNodes[0]; media.currentTime = 23;
  doc.dispatchEvent(new Event('astro:before-swap')); original.root = false; tiles = [];
  const replacement = tile('ordinary'); doc.dispatchEvent(new Event('astro:page-load'));
  await player.back(); await new Promise(r => setTimeout(r,5));
  assert.equal(slot.childNodes[0],media); assert.equal(media.currentTime,23); assert.equal(media.paused,false);
  assert.equal(replacement.childNodes[0].tag,'thumbnail');
});
test('a native film docks before navigation and reconnects to a new page tile', async () => {
  const original = tile('live','video'); player.playNative(original);
  const media = original.childNodes[0]; assert.ok(media instanceof Video);
  doc.dispatchEvent(new Event('astro:before-swap'));
  assert.equal(slot.childNodes[0],media); assert.equal(original.childNodes[0].tag,'thumbnail');
  original.root = false; tiles = []; const replacement = tile('live','video');
  doc.dispatchEvent(new Event('astro:page-load')); await player.back(); await new Promise(r => setTimeout(r,5));
  assert.equal(replacement.childNodes[0],media); assert.equal(media.paused,false);
  player.close(); assert.equal(replacement.childNodes[0].tag,'thumbnail'); assert.equal(dock.hidden,true);
});
