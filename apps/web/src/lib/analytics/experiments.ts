/**
 * Lightweight, cookieless A/B testing.
 *
 * Variants are assigned on first visit, persisted in localStorage, and written
 * to <html data-exp-ID="variant"> by an inline head script (no flicker; see
 * ExperimentBoot.astro). CSS shows the matching [data-variant] block.
 *
 * To add a test: add it here, render each variant with
 *   <span data-exp="cta_label" data-variant="b" hidden>...</span>
 * and read results in Plausible/GA4 by the exp_<id> property.
 */
export interface Experiment {
  id: string;
  variants: string[];
  /** Same length as variants; defaults to an even split. */
  weights?: number[];
  active: boolean;
}

/**
 * The test is paused (active: false; everyone sees the first variant) until there is
 * enough traffic to read them: at launch volume a two-arm test needs months to separate
 * a real difference from noise. Turn one back on when each arm gets a few hundred
 * sessions a week, and judge it on booked outcomes, not clicks alone.
 */
export const EXPERIMENTS: Experiment[] = [
  // Primary action label (first variant is the no-JS fallback). Primary metric: cta_click to inquiry_submit.
  { id: 'cta_label', variants: ['check_date', 'inquire'], active: false },
];

const KEY = 'sc_exp_v1';

export function readAssignments(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function getExperimentProps(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = document.documentElement;
  for (const exp of EXPERIMENTS) {
    if (!exp.active) continue;
    const v = root.dataset[`exp${exp.id.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())}`];
    if (v) out[`exp_${exp.id}`] = v;
  }
  return out;
}

/**
 * Serialized into the inline head script. Kept dependency-free on purpose.
 */
export function bootScript(): string {
  const active = EXPERIMENTS.filter((e) => e.active).map(({ id, variants, weights }) => ({ id, variants, weights }));
  return `(function(){var E=${JSON.stringify(active)},K=${JSON.stringify(KEY)},a={};try{a=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}
var q=new URLSearchParams(location.search);E.forEach(function(x){var f=q.get('exp_'+x.id);if(f&&x.variants.indexOf(f)>-1)a[x.id]=f;
if(!a[x.id]||x.variants.indexOf(a[x.id])<0){var w=x.weights||x.variants.map(function(){return 1}),t=w.reduce(function(s,n){return s+n},0),r=Math.random()*t,i=0;
for(;i<w.length;i++){r-=w[i];if(r<0)break}a[x.id]=x.variants[Math.min(i,x.variants.length-1)]}
document.documentElement.setAttribute('data-exp-'+x.id.replace(/_/g,'-'),a[x.id])});try{localStorage.setItem(K,JSON.stringify(a))}catch(e){}})();`; // soc2-ignore: PRIV003 - generated pre-paint boot script; sc_exp_v1 key, evicted by clearSiteData()
}

/**
 * CSS that reveals the active arm of each experiment, with the first variant as
 * the no-JS fallback. Inlined by Experiments.astro (CSP-hashed after the build).
 */
export function experimentsCss(): string {
  return EXPERIMENTS.map((e) => {
    const attr = `data-exp-${e.id.replace(/_/g, '-')}`;
    const sel = (v: string) => `.exp[data-exp="${e.id}"][data-variant="${v}"]`;
    const arms = e.variants.map((v) => `html[${attr}="${v}"] ${sel(v)}{display:revert}`).join('');
    const fallback = e.active ? `html:not([${attr}]) ${sel(e.variants[0])}{display:revert}` : `${sel(e.variants[0])}{display:revert}`;
    return arms + fallback;
  }).join('');
}
