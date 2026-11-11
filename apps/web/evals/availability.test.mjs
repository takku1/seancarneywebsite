import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const load = async (entry) => {
  const out = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node'});
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const {classifyDay, localToUtc, todayIn} = await load('src/lib/integrations/google-calendar.ts');

const TZ = 'America/Los_Angeles';
const at = (iso) => new Date(iso).toISOString();
const cal = (...blocks) => ({busy: blocks.map(([start, end]) => ({start: at(start), end: at(end)}))});
const day = (calendars, extra = {}) => classifyDay({calendars}, {date: '2027-06-12', timeZone: TZ, calendarIds: Object.keys(calendars).filter((k) => k !== 'holds'), ...extra});

test('local day boundaries follow daylight saving, including on transition days', () => {
  assert.equal(new Date(localToUtc('2027-06-12', 0, TZ)).toISOString(), '2027-06-12T07:00:00.000Z', 'PDT');
  assert.equal(new Date(localToUtc('2027-01-12', 0, TZ)).toISOString(), '2027-01-12T08:00:00.000Z', 'PST');
  // 2027-03-14: clocks spring forward at 2am. Midnight is PST, the next midnight PDT: a 23-hour day.
  assert.equal(new Date(localToUtc('2027-03-14', 0, TZ)).toISOString(), '2027-03-14T08:00:00.000Z');
  assert.equal(new Date(localToUtc('2027-03-14', 600, TZ)).toISOString(), '2027-03-14T17:00:00.000Z', '10am is PDT');
  assert.equal(new Date(localToUtc('2027-03-14', 1440, TZ)).toISOString(), '2027-03-15T07:00:00.000Z');
  // 2027-11-07: fall back, a 25-hour day.
  assert.equal(new Date(localToUtc('2027-11-07', 600, TZ)).toISOString(), '2027-11-07T18:00:00.000Z', '10am is PST');
  assert.equal(new Date(localToUtc('2027-11-07', 1440, TZ)).toISOString(), '2027-11-08T08:00:00.000Z');
});

test('today is the local date, not the UTC date', () => {
  // 8pm Pacific on June 11 is already June 12 in UTC.
  const now = Date.parse('2027-06-12T03:00:00Z');
  assert.equal(todayIn(TZ, now), '2027-06-11');
  assert.equal(new Date(now).toISOString().slice(0, 10), '2027-06-12');
});

test('a calendar error or a missing calendar means unknown, never open', () => {
  assert.equal(day({a: {busy: [], errors: [{domain: 'global', reason: 'notFound'}]}}).status, 'unknown');
  assert.equal(classifyDay({calendars: {}}, {date: '2027-06-12', timeZone: TZ, calendarIds: ['a']}).status, 'unknown');
  assert.equal(day({a: {busy: []}, holds: {busy: [], errors: [{reason: 'backendError'}]}}, {holdCalendarIds: ['holds']}).status, 'unknown');
  assert.equal(day({a: {busy: [{start: 'garbage', end: 'x'}]}}).status, 'unknown');
});

test('overlapping busy time across calendars counts once', () => {
  // Two calendars with the same 40 minutes (3:00-3:40pm PDT): 40 minutes, under the 60-minute threshold.
  const block = ['2027-06-12T22:00:00Z', '2027-06-12T22:40:00Z'];
  const r = day({a: cal(block), b: cal(block)});
  assert.equal(r.busyMinutes, 40);
  assert.equal(r.status, 'open');
});

test('only the performance window counts, in local time', () => {
  // 7-9am PDT: outside the 10am-midnight window.
  assert.equal(day({a: cal(['2027-06-12T14:00:00Z', '2027-06-12T16:00:00Z'])}).status, 'open');
  // 6-8pm PDT: inside.
  assert.equal(day({a: cal(['2027-06-13T01:00:00Z', '2027-06-13T03:00:00Z'])}).status, 'busy');
});

test('with a holds calendar: any hold is busy, personal time is only tentative', () => {
  const opts = {holdCalendarIds: ['holds']};
  const twoHours = ['2027-06-12T20:00:00Z', '2027-06-12T22:00:00Z'];
  assert.equal(day({holds: cal(), a: cal(twoHours)}, opts).status, 'tentative', 'a personal appointment needs confirmation, not a no');
  assert.equal(day({holds: cal(['2027-06-12T20:00:00Z', '2027-06-12T20:15:00Z']), a: cal()}, opts).status, 'busy', 'a 15-minute hold still blocks');
  assert.equal(day({holds: cal(), a: cal()}, opts).status, 'open');
  // A hold that ends before the window doesn't block the evening.
  assert.equal(day({holds: cal(['2027-06-12T14:00:00Z', '2027-06-12T16:00:00Z']), a: cal()}, opts).status, 'open');
});

test('without a holds calendar, an hour of combined busy time is busy', () => {
  assert.equal(day({a: cal(['2027-06-12T20:00:00Z', '2027-06-12T20:30:00Z']), b: cal(['2027-06-12T20:30:00Z', '2027-06-12T21:00:00Z'])}).status, 'busy');
});
