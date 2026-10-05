import { addDecimals, parseDecimal, subtractDecimals } from './exact-decimal.mjs';

const matchesFilter = (properties, filter) => (
  filter.operator === 'not-equals'
    ? properties[filter.property] !== filter.value
    : properties[filter.property] === filter.value
);

export const sourceMatchesFilters = (properties, filters = []) => (
  filters.every((filter) => matchesFilter(properties, filter))
);

export const numericContribution = (rule, properties) => {
  if (rule.kind === 'related-sum') return parseDecimal(properties[rule.amountProperty] ?? 0);
  if (rule.kind === 'related-difference-sum') {
    return subtractDecimals(
      parseDecimal(properties[rule.positiveProperty] ?? 0),
      parseDecimal(properties[rule.negativeProperty] ?? 0)
    );
  }
  throw new TypeError(`unsupported numeric rule: ${rule.kind}`);
};

export const aggregateNumericRule = (rule, sourceProperties) => sourceProperties
  .filter((properties) => sourceMatchesFilters(properties, rule.filters))
  .map((properties) => numericContribution(rule, properties))
  .reduce((total, contribution) => addDecimals(total, contribution), { coefficient: 0n, scale: 0 });
