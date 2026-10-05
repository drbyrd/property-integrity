import test from 'node:test';
import assert from 'node:assert/strict';
import { IntegrityRuntime } from '../src/runtime.mjs';

const settings = (activation = 'active') => ({
  schemaVersion: 1,
  enabled: true,
  numericRules: [{
    id: 'total', kind: 'related-sum', activation, targetFolder: 'Records/Targets', sourceFolder: 'Records/Sources',
    relationProperty: 'Target', amountProperty: 'Amount', outputProperty: 'Total'
  }],
  relationshipRules: [],
  journal: { enabled: true, maxEntries: 10 }
});
const plan = { ruleId: 'total', writes: [{ path: 'Records/Targets/One.md', property: 'Total' }], preHashes: { a: 'before' }, postHashes: { a: 'after' } };

test('does not subscribe while globally disabled', async () => {
  let subscriptions = 0;
  const runtime = new IntegrityRuntime({ engine: { plan: async () => [] }, adapter: { subscribe: () => { subscriptions += 1; } } });
  assert.deepEqual(await runtime.start({}), { started: false, reason: 'disabled' });
  assert.equal(subscriptions, 0);
});

test('previews without writing and journals metadata only', async () => {
  let writes = 0;
  const runtime = new IntegrityRuntime({
    engine: { plan: async () => [plan] },
    adapter: { subscribe: () => () => {}, apply: async () => { writes += 1; } },
    now: () => '2026-09-30T00:00:00.000Z'
  });
  await runtime.start(settings('preview'));
  const result = await runtime.handle({ path: 'Records/Sources/One.md' });
  assert.equal(result.results[0].status, 'preview');
  assert.equal(writes, 0);
  assert.deepEqual(Object.keys(runtime.journal[0]).sort(), ['code', 'paths', 'postHashes', 'preHashes', 'properties', 'ruleId', 'status', 'timestamp']);
});

test('applies active plans and suppresses self-write events', async () => {
  let handler; let writes = 0;
  const runtime = new IntegrityRuntime({
    engine: { plan: async () => [plan] },
    adapter: {
      subscribe: (callback) => { handler = callback; return () => {}; },
      apply: async () => { writes += 1; assert.equal((await handler({ path: plan.writes[0].path })).status, 'ignored'); return {}; }
    }
  });
  await runtime.start(settings());
  const result = await runtime.handle({ path: 'Records/Sources/One.md' });
  assert.equal(result.results[0].status, 'applied');
  assert.equal(writes, 1);
});

test('pauses a rule after three identical failures', async () => {
  const error = Object.assign(new Error('preimage mismatch'), { code: 'STALE' });
  const runtime = new IntegrityRuntime({
    engine: { plan: async () => [plan] },
    adapter: { subscribe: () => () => {}, apply: async () => { throw error; } }
  });
  await runtime.start(settings());
  for (let index = 0; index < 3; index += 1) await assert.rejects(() => runtime.handle({ path: `Records/Sources/${index}.md` }), /preimage mismatch/);
  assert.equal(runtime.pausedRules.has('total'), true);
  const after = await runtime.handle({ path: 'Records/Sources/after.md' });
  assert.equal(after.results[0].status, 'ignored');
});
