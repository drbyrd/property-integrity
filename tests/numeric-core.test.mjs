import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToString } from '../src/exact-decimal.mjs';
import { aggregateNumericRule, numericContribution, sourceMatchesFilters } from '../src/numeric-core.mjs';

const rule = {
  kind: 'related-difference-sum',
  positiveProperty: 'Credit',
  negativeProperty: 'Debit',
  filters: [{ property: 'State', operator: 'not-equals', value: 'Ignored' }]
};

test('computes an exact configurable difference', () => {
  assert.equal(decimalToString(numericContribution(rule, { Credit: '0.3', Debit: '0.2' })), '0.1');
  assert.equal(decimalToString(numericContribution(rule, { Credit: '0', Debit: '9.93' })), '-9.93');
});

test('applies the configured condition before summing exact differences', () => {
  const sources = [
    { State: 'Accepted', Credit: '614.57', Debit: '0' },
    { State: 'Accepted', Credit: '0', Debit: '9.93' },
    { State: 'Ignored', Credit: '0', Debit: '25' }
  ];
  assert.equal(sourceMatchesFilters(sources[0], rule.filters), true);
  assert.equal(sourceMatchesFilters(sources[2], rule.filters), false);
  assert.equal(decimalToString(aggregateNumericRule(rule, sources)), '604.64');
});

test('preserves the existing single-property sum', () => {
  const sumRule = { kind: 'related-sum', amountProperty: 'Amount', filters: [] };
  assert.equal(decimalToString(aggregateNumericRule(sumRule, [{ Amount: '0.1' }, { Amount: '0.2' }])), '0.3');
});
