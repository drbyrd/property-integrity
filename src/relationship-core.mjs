export class RelationshipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RelationshipError';
    this.code = code;
  }
}

export const normalizeNotePath = (value) => String(value ?? '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');

export const wikiLinkTarget = (value) => {
  const match = String(value ?? '').trim().match(/^\[\[([^|#\]]+)/);
  if (!match) throw new RelationshipError('INVALID_LINK', 'invalid wiki link value');
  return normalizeNotePath(match[1]);
};

export const uniqueSortedPaths = (values) => [...new Set(values.map(normalizeNotePath).filter(Boolean))].sort();

const assertNoDuplicates = (values, label) => {
  const normalized = values.map(normalizeNotePath).filter(Boolean);
  if (normalized.length !== uniqueSortedPaths(values).length) {
    throw new RelationshipError('DUPLICATE', `duplicate relationship reference in ${label}`);
  }
};

export const relationshipState = ({ memberPath, ownerPaths, memberOwner, ownerMembers }) => {
  const member = normalizeNotePath(memberPath);
  const owners = uniqueSortedPaths(ownerPaths);
  const selected = memberOwner ? normalizeNotePath(memberOwner) : null;
  if (selected && !owners.includes(selected)) throw new RelationshipError('OUT_OF_SCOPE', `owner is outside the declared scope: ${selected}`);
  const membership = [];
  for (const owner of owners) {
    const values = uniqueSortedPaths(ownerMembers[owner] ?? []);
    if ((ownerMembers[owner] ?? []).map(normalizeNotePath).filter(Boolean).length !== values.length) {
      throw new RelationshipError('DUPLICATE', `duplicate member reference in ${owner}`);
    }
    if (values.includes(member)) membership.push(owner);
  }
  return { memberOwner: selected, ownerMembership: membership.sort() };
};

export const manyToManyState = ({ leftPath, rightPaths, leftRights, rightLefts }) => {
  const left = normalizeNotePath(leftPath);
  const rights = uniqueSortedPaths(rightPaths);
  assertNoDuplicates(leftRights, left);
  const selectedRights = uniqueSortedPaths(leftRights);
  for (const right of selectedRights) {
    if (!rights.includes(right)) throw new RelationshipError('OUT_OF_SCOPE', `right endpoint is outside the declared scope: ${right}`);
  }
  const rightMembership = [];
  for (const right of rights) {
    const values = rightLefts[right] ?? [];
    assertNoDuplicates(values, right);
    if (uniqueSortedPaths(values).includes(left)) rightMembership.push(right);
  }
  return { leftRights: selectedRights, rightMembership: rightMembership.sort() };
};

const statesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stateIsConsistent = (state) => statesEqual(state.ownerMembership, state.memberOwner ? [state.memberOwner] : []);

export const reconcileSingleToMany = ({ memberPath, ownerPaths, memberOwner, ownerMembers, baseline = null }) => {
  const current = relationshipState({ memberPath, ownerPaths, memberOwner, ownerMembers });
  if (!baseline) {
    if (!stateIsConsistent(current)) throw new RelationshipError('INITIAL_INCONSISTENCY', 'relationship must be reciprocal before activation');
    return { memberOwner: current.memberOwner, ownerMembers, acceptedState: current, writes: [], direction: 'initialize' };
  }

  const memberChanged = current.memberOwner !== baseline.memberOwner;
  const ownersChanged = !statesEqual(current.ownerMembership, baseline.ownerMembership);
  if (!memberChanged && !ownersChanged) return { memberOwner: current.memberOwner, ownerMembers, acceptedState: current, writes: [], direction: 'no-change' };
  if (memberChanged && ownersChanged) {
    if (!stateIsConsistent(current)) throw new RelationshipError('OPPOSITE_ENDPOINT_CONFLICT', 'both endpoints changed to conflicting states');
    return { memberOwner: current.memberOwner, ownerMembers, acceptedState: current, writes: [], direction: 'consistent-two-endpoint-edit' };
  }

  const member = normalizeNotePath(memberPath);
  const owners = uniqueSortedPaths(ownerPaths);
  let nextMemberOwner = current.memberOwner;
  const nextOwnerMembers = Object.fromEntries(owners.map((owner) => [owner, uniqueSortedPaths(ownerMembers[owner] ?? [])]));
  const writes = [];

  if (memberChanged) {
    for (const owner of owners) {
      const retained = nextOwnerMembers[owner].filter((path) => path !== member);
      const desired = current.memberOwner === owner ? uniqueSortedPaths([...retained, member]) : retained;
      if (!statesEqual(desired, nextOwnerMembers[owner])) {
        nextOwnerMembers[owner] = desired;
        writes.push({ endpoint: 'owner', path: owner });
      }
    }
  } else {
    if (current.ownerMembership.length > 1) throw new RelationshipError('CARDINALITY', 'member cannot belong to multiple owners');
    nextMemberOwner = current.ownerMembership[0] ?? null;
    writes.push({ endpoint: 'member', path: member });
  }

  const acceptedState = relationshipState({ memberPath: member, ownerPaths: owners, memberOwner: nextMemberOwner, ownerMembers: nextOwnerMembers });
  if (!stateIsConsistent(acceptedState)) throw new RelationshipError('POSTCONDITION', 'planned relationship is not reciprocal');
  return {
    memberOwner: nextMemberOwner,
    ownerMembers: nextOwnerMembers,
    acceptedState,
    writes,
    direction: memberChanged ? 'member-to-owners' : 'owners-to-member'
  };
};


export const reconcileManyToMany = ({ leftPath, rightPaths, leftRights, rightLefts, baseline = null }) => {
  const current = manyToManyState({ leftPath, rightPaths, leftRights, rightLefts });
  const isConsistent = (state) => statesEqual(state.leftRights, state.rightMembership);
  if (!baseline) {
    if (!isConsistent(current)) throw new RelationshipError('INITIAL_INCONSISTENCY', 'relationship must be reciprocal before activation');
    return { leftRights: current.leftRights, rightLefts, acceptedState: current, writes: [], direction: 'initialize' };
  }

  const leftChanged = !statesEqual(current.leftRights, baseline.leftRights);
  const rightsChanged = !statesEqual(current.rightMembership, baseline.rightMembership);
  if (!leftChanged && !rightsChanged) {
    return { leftRights: current.leftRights, rightLefts, acceptedState: current, writes: [], direction: 'no-change' };
  }
  if (leftChanged && rightsChanged) {
    if (!isConsistent(current)) throw new RelationshipError('OPPOSITE_ENDPOINT_CONFLICT', 'both endpoints changed to conflicting states');
    return { leftRights: current.leftRights, rightLefts, acceptedState: current, writes: [], direction: 'consistent-two-endpoint-edit' };
  }

  const left = normalizeNotePath(leftPath);
  const rights = uniqueSortedPaths(rightPaths);
  let nextLeftRights = current.leftRights;
  const nextRightLefts = Object.fromEntries(rights.map((right) => [right, uniqueSortedPaths(rightLefts[right] ?? [])]));
  const writes = [];

  if (leftChanged) {
    for (const right of rights) {
      const retained = nextRightLefts[right].filter((path) => path !== left);
      const desired = current.leftRights.includes(right) ? uniqueSortedPaths([...retained, left]) : retained;
      if (!statesEqual(desired, nextRightLefts[right])) {
        nextRightLefts[right] = desired;
        writes.push({ endpoint: 'right', path: right });
      }
    }
  } else {
    nextLeftRights = current.rightMembership;
    writes.push({ endpoint: 'left', path: left });
  }

  const acceptedState = manyToManyState({ leftPath: left, rightPaths: rights, leftRights: nextLeftRights, rightLefts: nextRightLefts });
  if (!isConsistent(acceptedState)) throw new RelationshipError('POSTCONDITION', 'planned relationship is not reciprocal');
  return {
    leftRights: nextLeftRights,
    rightLefts: nextRightLefts,
    acceptedState,
    writes,
    direction: leftChanged ? 'left-to-rights' : 'rights-to-left'
  };
};
