/**
 * Lightweight, cookieless A/B testing.
 *
 * Variants are assigned on first visit, persisted in localStorage, and written
 * to <html data-exp-ID="variant"> by an inline head script (no flicker; see
 * ExperimentBoot.astro). CSS shows the matching [data-variant] block.
 *
 * To add a test: add it here, render each variant with
 *   <span data-exp="hero_sub" data-variant="b" hidden>...</span>
 * and read results in Plausible/GA4 by the exp_<id> property.
 */
export interface Experiment {
  id: string;
  variants: string[];
  /** Same length as variants; defaults to an even split. */
  weights?: number[];
  active: boolean;
}

export const EXPERIMENTS: Experiment[] = [
  // Status-led vs service-led hero line. Primary metric: inquiry_start rate.
  { id: 'hero_sub', variants: ['status', 'service'], active: true },
  // Inquiry CTA label. Primary metric: cta_click to inquiry_submit.
  { id: 'cta_label', variants: ['inquire', 'check_date'], active: true },
  // Events-zone theme. Hypothesis (research report: bone/ivory service zone,
  // NN/g plain task areas): ivory lifts inquiry_start per event-page view vs
  // the cinematic night theme. Applied only on data-zone="events" pages.
  // Secondary: inquiry_submit, scroll_depth, engaged_time.
  { id: 'events_theme', variants: ['ivory', 'night'], active: true },
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
