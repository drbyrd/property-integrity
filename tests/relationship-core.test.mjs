import test from 'node:test';
import assert from 'node:assert/strict';
import {
  manyToManyState,
  reconcileManyToMany,
  reconcileSingleToMany,
  RelationshipError,
  relationshipState,
  wikiLinkTarget
} from '../src/relationship-core.mjs';

const memberPath = 'Work/Items/Item One';
const ownerPaths = ['Work/Groups/Group One', 'Work/Groups/Group Two'];
const baselineMembers = {
  'Work/Groups/Group One': [memberPath],
  'Work/Groups/Group Two': []
};

test('extracts a normalized wiki-link target', () => {
  assert.equal(wikiLinkTarget('[[Work/Groups/Group One.md|Group One]]'), 'Work/Groups/Group One');
  assert.throws(() => wikiLinkTarget('PRIVATE-VALUE'), (error) => error.code === 'INVALID_LINK' && !error.message.includes('PRIVATE-VALUE'));
});

test('moves the inverse endpoint when the single endpoint changes', () => {
  const baseline = relationshipState({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers: baselineMembers });
  const result = reconcileSingleToMany({ memberPath, ownerPaths, memberOwner: ownerPaths[1], ownerMembers: baselineMembers, baseline });
  assert.equal(result.direction, 'member-to-owners');
  assert.deepEqual(result.ownerMembers[ownerPaths[0]], []);
  assert.deepEqual(result.ownerMembers[ownerPaths[1]], [memberPath]);
  assert.deepEqual(result.acceptedState, { memberOwner: ownerPaths[1], ownerMembership: [ownerPaths[1]] });
});

test('updates the single endpoint when the inverse endpoint changes', () => {
  const baseline = relationshipState({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers: baselineMembers });
  const ownerMembers = { [ownerPaths[0]]: [], [ownerPaths[1]]: [memberPath] };
  const result = reconcileSingleToMany({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers, baseline });
  assert.equal(result.direction, 'owners-to-member');
  assert.equal(result.memberOwner, ownerPaths[1]);
});

test('fails closed on conflicting simultaneous edits', () => {
  const baseline = relationshipState({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers: baselineMembers });
  const ownerMembers = { [ownerPaths[0]]: [], [ownerPaths[1]]: [] };
  assert.throws(
    () => reconcileSingleToMany({ memberPath, ownerPaths, memberOwner: ownerPaths[1], ownerMembers, baseline }),
    (error) => error instanceof RelationshipError && error.code === 'OPPOSITE_ENDPOINT_CONFLICT'
  );
});

test('fails closed on multiple inverse owners', () => {
  const baseline = relationshipState({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers: baselineMembers });
  const ownerMembers = { [ownerPaths[0]]: [memberPath], [ownerPaths[1]]: [memberPath] };
  assert.throws(
    () => reconcileSingleToMany({ memberPath, ownerPaths, memberOwner: ownerPaths[0], ownerMembers, baseline }),
    (error) => error instanceof RelationshipError && error.code === 'CARDINALITY'
  );
});

const leftPath = 'Records/Transactions/Transaction One';
const rightPaths = ['Records/Components/Component One', 'Records/Components/Component Two'];
const reciprocalRights = {
  [rightPaths[0]]: [leftPath],
  [rightPaths[1]]: []
};

test('adds and removes many-to-many links from the left endpoint', () => {
  const baseline = manyToManyState({ leftPath, rightPaths, leftRights: [rightPaths[0]], rightLefts: reciprocalRights });
  const result = reconcileManyToMany({ leftPath, rightPaths, leftRights: [rightPaths[1]], rightLefts: reciprocalRights, baseline });
  assert.equal(result.direction, 'left-to-rights');
  assert.deepEqual(result.rightLefts[rightPaths[0]], []);
  assert.deepEqual(result.rightLefts[rightPaths[1]], [leftPath]);
  assert.deepEqual(result.acceptedState.leftRights, [rightPaths[1]]);
});

test('supports multiple links and reconciles edits from the right endpoints', () => {
  const baseline = manyToManyState({ leftPath, rightPaths, leftRights: [rightPaths[0]], rightLefts: reciprocalRights });
  const rightLefts = { [rightPaths[0]]: [leftPath], [rightPaths[1]]: [leftPath] };
  const result = reconcileManyToMany({ leftPath, rightPaths, leftRights: [rightPaths[0]], rightLefts, baseline });
  assert.equal(result.direction, 'rights-to-left');
  assert.deepEqual(result.leftRights, rightPaths);
});

test('accepts a consistent simultaneous many-to-many edit without a write', () => {
  const baseline = manyToManyState({ leftPath, rightPaths, leftRights: [rightPaths[0]], rightLefts: reciprocalRights });
  const rightLefts = { [rightPaths[0]]: [], [rightPaths[1]]: [leftPath] };
  const result = reconcileManyToMany({ leftPath, rightPaths, leftRights: [rightPaths[1]], rightLefts, baseline });
  assert.equal(result.direction, 'consistent-two-endpoint-edit');
  assert.deepEqual(result.writes, []);
});

test('fails closed on a conflicting simultaneous many-to-many edit', () => {
  const baseline = manyToManyState({ leftPath, rightPaths, leftRights: [rightPaths[0]], rightLefts: reciprocalRights });
  const rightLefts = { [rightPaths[0]]: [], [rightPaths[1]]: [] };
  assert.throws(
    () => reconcileManyToMany({ leftPath, rightPaths, leftRights: [rightPaths[1]], rightLefts, baseline }),
    (error) => error instanceof RelationshipError && error.code === 'OPPOSITE_ENDPOINT_CONFLICT'
  );
});

test('rejects duplicate and out-of-scope many-to-many links', () => {
  assert.throws(
    () => manyToManyState({ leftPath, rightPaths, leftRights: [rightPaths[0], rightPaths[0]], rightLefts: reciprocalRights }),
    (error) => error instanceof RelationshipError && error.code === 'DUPLICATE'
  );
  assert.throws(
    () => manyToManyState({ leftPath, rightPaths, leftRights: ['Records/Outside/Other'], rightLefts: reciprocalRights }),
    (error) => error instanceof RelationshipError && error.code === 'OUT_OF_SCOPE'
  );
});
