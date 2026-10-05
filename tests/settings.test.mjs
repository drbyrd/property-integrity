import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, migrateSettings, validateSettings } from '../src/settings.mjs';

const numericRule = {
  id: 'account-total', kind: 'related-sum', activation: 'preview', targetFolder: 'Records/Accounts', sourceFolder: 'Records/Entries',
  relationProperty: 'Account', amountProperty: 'Amount', outputProperty: 'Balance', rawProperty: 'Balance Exact',
  filters: [{ property: 'Status', value: 'Complete' }]
};
const relationshipRule = {
  id: 'item-group', kind: 'single-to-many', activation: 'active', memberFolder: 'Work/Items', memberProperty: 'Group',
  ownerFolder: 'Work/Groups', inverseProperty: 'Items'
};
const manyToManyRule = {
  id: 'transaction-component', kind: 'many-to-many', activation: 'preview',
  leftFolder: 'Records/Transactions', leftProperty: 'Components',
  rightFolder: 'Records/Components', rightProperty: 'Transactions', leftSerialization: 'quoted-wiki-link-list'
};
const differenceRule = {
  id: 'filtered-net', kind: 'related-difference-sum', activation: 'preview', targetFolder: 'Records/Owners', sourceFolder: 'Records/Entries',
  relationProperty: 'Owner', positiveProperty: 'Credit', negativeProperty: 'Debit', outputProperty: 'Net',
  filters: [{ property: 'State', operator: 'not-equals', value: 'Ignored' }]
};

test('defaults are disabled and contain no rules', () => {
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
});

test('validates generic numeric and relationship rules', () => {
  const settings = validateSettings({ schemaVersion: 1, enabled: true, numericRules: [numericRule], relationshipRules: [relationshipRule] });
  assert.equal(settings.numericRules[0].displayDecimals, 2);
  assert.equal(settings.numericRules[0].rawProperty, 'Balance Exact');
  assert.equal(settings.relationshipRules[0].cardinality, 'zero-or-one-to-many');
});

test('validates exact single-to-many member and owner path allowlists', () => {
  const settings = validateSettings({ schemaVersion: 1, relationshipRules: [{
    ...relationshipRule,
    memberPaths: ['Work/Items/Item One.md'],
    ownerPaths: ['Work/Groups/Group One', 'Work/Groups/Group Two.md']
  }] });
  assert.deepEqual(settings.relationshipRules[0].memberPaths, ['Work/Items/Item One']);
  assert.deepEqual(settings.relationshipRules[0].ownerPaths, ['Work/Groups/Group One', 'Work/Groups/Group Two']);
});

test('rejects empty, duplicate, and out-of-folder relationship allowlists', () => {
  assert.throws(() => validateSettings({ schemaVersion: 1, relationshipRules: [{ ...relationshipRule, memberPaths: [] }] }), /non-empty array/);
  assert.throws(() => validateSettings({ schemaVersion: 1, relationshipRules: [{ ...relationshipRule, ownerPaths: ['Work/Groups/One', 'Work/Groups/One.md'] }] }), /duplicates/);
  assert.throws(() => validateSettings({ schemaVersion: 1, relationshipRules: [{ ...relationshipRule, memberPaths: ['Work/Other/Item'] }] }), /inside Work\/Items/);
});

test('validates a generic many-to-many relationship rule without a cardinality cap', () => {
  const settings = validateSettings({ schemaVersion: 1, relationshipRules: [manyToManyRule] });
  assert.deepEqual(settings.relationshipRules[0], { ...manyToManyRule, cardinality: 'many-to-many' });
});

test('validates a generic filtered difference sum without private field names', () => {
  const settings = validateSettings({ schemaVersion: 1, enabled: true, numericRules: [differenceRule] });
  assert.equal(settings.numericRules[0].kind, 'related-difference-sum');
  assert.equal(settings.numericRules[0].positiveProperty, 'Credit');
  assert.equal(settings.numericRules[0].negativeProperty, 'Debit');
  assert.equal(settings.numericRules[0].filters[0].operator, 'not-equals');
});

test('migrates the bounded version-zero shape', () => {
  const migrated = migrateSettings({ version: 0, enabled: true, balances: [numericRule], relations: [relationshipRule] });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.numericRules.length, 1);
});

test('rejects unsafe folders, duplicate ids, and unknown schemas', () => {
  assert.throws(() => validateSettings({ schemaVersion: 1, numericRules: [{ ...numericRule, targetFolder: '../outside' }] }), /vault-relative/);
  assert.throws(() => validateSettings({ schemaVersion: 1, numericRules: [numericRule], relationshipRules: [{ ...relationshipRule, id: numericRule.id }] }), /unique/);
  assert.throws(() => migrateSettings({ schemaVersion: 99 }), /unsupported/);
  assert.throws(() => validateSettings({ schemaVersion: 1, numericRules: [{ ...differenceRule, positiveProperty: '' }] }), /positiveProperty/);
});
