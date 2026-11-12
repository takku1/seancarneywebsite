import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const out = await build({entryPoints: ['src/lib/inquiry/schema.ts'], bundle: true, write: false, format: 'esm', platform: 'node'});
const {scoreLead, inquirySchema} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const NOW = new Date('2027-01-10T12:00:00Z');
const inq = (o) => inquirySchema.parse({event_type: 'wedding', location: 'Santa Barbara', budget: 'discuss', name: 'Test Person', email: 't@example.com', role: 'couple', ...o});

test('a planner with a modest budget is not ranked below a large anonymous budget', () => {
  const big = scoreLead(inq({budget: '40k_plus', role: 'couple', format: 'unsure', event_date: '2027-09-18'}), NOW);
  const planner = scoreLead(inq({budget: '10k_20k', role: 'planner', format: 'band', event_date: '2027-09-18'}), NOW);
  assert.equal(big.tier, 'A');
  assert.equal(planner.tier, 'A', 'trade partners can bring repeat work');
  assert.equal(planner.relationship, 30);
});

test('budget counts, but alone it does not decide the tier', () => {
  const r = scoreLead(inq({budget: '40k_plus'}), NOW); // no date, no format
  assert.ok(r.fit < 45, `fit ${r.fit}`);
  assert.equal(r.tier, 'B');
});

test('an urgent date with a workable fit goes to the front', () => {
  const r = scoreLead(inq({budget: '10k_20k', event_date: '2027-01-30'}), NOW);
  assert.equal(r.urgency, 30);
  assert.equal(r.tier, 'A');
});

test('format is not ranked: Solo, Duo and Band score the same', () => {
  const s = (format) => scoreLead(inq({format, event_date: '2027-09-18'}), NOW).score;
  assert.equal(s('solo'), s('band'));
  assert.equal(s('small'), s('band'));
});

test('the dimensions add up to the score and every lead gets a tier', () => {
  for (const budget of ['under_5k', '5k_10k', '10k_20k', '20k_40k', '40k_plus', 'discuss']) {
    for (const role of ['couple', 'planner', 'corporate', 'venue', 'other']) {
      const r = scoreLead(inq({budget, role}), NOW);
      assert.equal(r.score, r.fit + r.relationship + r.urgency);
      assert.ok(['A', 'B', 'C'].includes(r.tier));
    }
  }
  assert.equal(scoreLead(inq({budget: 'under_5k'}), NOW).tier, 'C');
});

test('a past date is flagged, not rewarded', () => {
  const r = scoreLead(inq({event_date: '2026-12-01'}), NOW);
  assert.ok(r.signals.includes('date_in_past'));
  assert.equal(r.urgency, 0);
});

test('a referral from a planner or venue ranks like a trade partner; from a past client or friend, half as much', () => {
  const base = {budget: '10k_20k', event_date: '2027-09-18'};
  const planner = scoreLead(inq({...base, heard_via: 'planner', referrer: 'Laurel Events'}), NOW);
  assert.equal(planner.relationship, 30);
  assert.equal(planner.tier, 'A');
  assert.ok(planner.signals.includes('referral:planner'));
  const friend = scoreLead(inq({...base, heard_via: 'friend'}), NOW);
  assert.equal(friend.relationship, 15);
  const search = scoreLead(inq({...base, heard_via: 'search'}), NOW);
  assert.equal(search.relationship, 0, 'self-found visitors are not penalised, just not boosted');
});

test('relationship is the larger signal, never a sum past its 30-point cap', () => {
  const r = scoreLead(inq({role: 'planner', heard_via: 'friend'}), NOW);
  assert.equal(r.relationship, 30);
  const c = scoreLead(inq({role: 'corporate', heard_via: 'venue'}), NOW);
  assert.equal(c.relationship, 30);
});

test('how they heard is optional and validated', () => {
  assert.equal(inq({}).heard_via, undefined);
  assert.throws(() => inq({heard_via: 'billboard'}));
  assert.throws(() => inq({referrer: 'x'.repeat(121)}));
  assert.equal(inq({referrer: '  Laurel Events  '}).referrer, 'Laurel Events');
});
