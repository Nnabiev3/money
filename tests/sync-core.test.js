const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyToSnapshot, computeDiff, isEmptyDiff, makeSnapshot, mergeFirstRun, splitDiff, stableStringify, syncableSettings, SYNC_CHUNK
} = require('../js/sync-core.js');

const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T09:00:00.000Z', ...overrides
});
const settings = (overrides = {}) => ({
  goal: 1000000, goalName: 'Цель', currency: '₽', theme: 'dark', categories: { income: ['Зарплата'], expense: ['Еда'] }, ...overrides
});

test('stableStringify ignores key order, including nested keys', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('syncableSettings drops the per-device theme', () => {
  assert.deepEqual(syncableSettings(settings({ theme: 'light' })), syncableSettings(settings({ theme: 'dark' })));
  assert.equal('theme' in syncableSettings(settings()), false);
});

test('an unchanged state produces an empty diff', () => {
  const snapshot = makeSnapshot([op('a')], settings(), 100000);
  assert.equal(isEmptyDiff(computeDiff(snapshot, [op('a')], settings(), 100000)), true);
});

test('a theme change alone is not a diff', () => {
  const snapshot = makeSnapshot([], settings({ theme: 'dark' }), 100000);
  assert.equal(isEmptyDiff(computeDiff(snapshot, [], settings({ theme: 'light' }), 100000)), true);
});

test('new, edited and deleted operations are detected', () => {
  const snapshot = makeSnapshot([op('keep'), op('edit'), op('gone')], settings(), 100000);
  const diff = computeDiff(snapshot, [op('keep'), op('edit', { amount: 999 }), op('new')], settings(), 100000);
  assert.deepEqual(diff.upsert.map(o => o.id).sort(), ['edit', 'new']);
  assert.deepEqual(diff.remove, ['gone']);
  assert.equal(diff.settings, undefined);
  assert.equal(diff.monthTarget, undefined);
});

test('settings and month target changes are detected', () => {
  const snapshot = makeSnapshot([], settings(), 100000);
  const diff = computeDiff(snapshot, [], settings({ goal: 5 }), 150000);
  assert.equal(diff.settings.goal, 5);
  assert.equal('theme' in diff.settings, false);
  assert.equal(diff.monthTarget, 150000);
});

test('splitDiff cuts upserts and removals into chunks and puts settings only in the first', () => {
  const upsert = Array.from({ length: 250 }, (_, i) => op(`u${i}`));
  const remove = Array.from({ length: 120 }, (_, i) => `r${i}`);
  const payloads = splitDiff({ upsert, remove, settings: { goal: 1 }, monthTarget: 7 });

  assert.equal(SYNC_CHUNK, 100);
  assert.equal(payloads.length, 3);
  assert.deepEqual(payloads[0].settings, { goal: 1 });
  assert.equal(payloads[0].monthTarget, 7);
  assert.equal(payloads[1].settings, undefined);
  for (const payload of payloads) {
    assert.ok(payload.upsert.length <= 100);
    assert.ok(payload.remove.length <= 100);
  }
  assert.equal(payloads.flatMap(p => p.upsert).length, 250);
  assert.equal(payloads.flatMap(p => p.remove).length, 120);
});

test('splitDiff of an empty diff is empty, of a settings-only diff is one payload', () => {
  assert.deepEqual(splitDiff({ upsert: [], remove: [] }), []);
  assert.equal(splitDiff({ upsert: [], remove: [], monthTarget: 5 }).length, 1);
});

test('applying every payload to the snapshot leaves nothing to send', () => {
  const local = Array.from({ length: 230 }, (_, i) => op(`id${i}`));
  let snapshot = makeSnapshot([], settings(), 100000);
  const diff = computeDiff(snapshot, local, settings({ goal: 5 }), 150000);
  for (const payload of splitDiff(diff)) snapshot = applyToSnapshot(snapshot, payload);
  assert.equal(isEmptyDiff(computeDiff(snapshot, local, settings({ goal: 5 }), 150000)), true);
});

test('an interrupted upload resumes with only the part that did not go through', () => {
  const local = Array.from({ length: 250 }, (_, i) => op(`id${i}`));
  let snapshot = makeSnapshot([], settings(), 100000);
  const [first, second] = splitDiff(computeDiff(snapshot, local, settings(), 100000));
  snapshot = applyToSnapshot(snapshot, first);
  snapshot = applyToSnapshot(snapshot, second); // третья порция «не дошла»

  const rest = computeDiff(snapshot, local, settings(), 100000);
  assert.equal(rest.upsert.length, 50);
  assert.equal(rest.remove.length, 0);
});

test('applyToSnapshot does not mutate the snapshot it was given', () => {
  const snapshot = makeSnapshot([op('a')], settings(), 100000);
  const copy = JSON.stringify(snapshot);
  applyToSnapshot(snapshot, { upsert: [op('b')], remove: ['a'] });
  assert.equal(JSON.stringify(snapshot), copy);
});

const defaults = { settings: syncableSettings(settings()), monthTarget: 100000 };

test('first run: server operations plus the local ones the server does not know', () => {
  const server = { operations: [op('s1'), op('shared', { amount: 1 })], settings: syncableSettings(settings()), monthTarget: 100000 };
  const local = { operations: [op('shared', { amount: 2 }), op('l1')], settings: syncableSettings(settings({ goal: 5 })), monthTarget: 150000 };
  const merged = mergeFirstRun(local, server, defaults);

  assert.deepEqual(merged.operations.map(o => o.id), ['s1', 'shared', 'l1']);
  assert.equal(merged.operations.find(o => o.id === 'shared').amount, 1, 'the server copy wins for the same id');
});

test('first run: default server settings give way to the local ones, customised ones win', () => {
  const localSettings = syncableSettings(settings({ goal: 5 }));
  const fresh = mergeFirstRun(
    { operations: [], settings: localSettings, monthTarget: 150000 },
    { operations: [], settings: defaults.settings, monthTarget: 100000 }, defaults
  );
  assert.deepEqual(fresh.settings, localSettings);
  assert.equal(fresh.monthTarget, 150000);

  const customServer = syncableSettings(settings({ goal: 9 }));
  const kept = mergeFirstRun(
    { operations: [], settings: localSettings, monthTarget: 150000 },
    { operations: [], settings: customServer, monthTarget: 200000 }, defaults
  );
  assert.deepEqual(kept.settings, customServer);
  assert.equal(kept.monthTarget, 200000);
});
