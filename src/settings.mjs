export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  enabled: false,
  numericRules: [],
  relationshipRules: [],
  journal: { enabled: true, maxEntries: 500 }
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireString = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};
const requireFolder = (value, label) => {
  const folder = requireString(value, label).replace(/\/$/, '');
  if (folder.startsWith('/') || folder.includes('..') || /^[A-Za-z]:/.test(folder)) throw new TypeError(`${label} must be a vault-relative folder`);
  return folder;
};
const requireOptionalPaths = (value, label, folder) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array when provided`);
  const paths = value.map((entry, index) => requireFolder(entry, `${label}[${index}]`).replace(/\.md$/i, ''));
  if (new Set(paths).size !== paths.length) throw new TypeError(`${label} must not contain duplicates`);
  if (paths.some((entry) => entry !== folder && !entry.startsWith(`${folder}/`))) throw new TypeError(`${label} entries must be inside ${folder}`);
  return paths;
};
const requireActivation = (value, label) => {
  if (!['disabled', 'preview', 'active'].includes(value)) throw new TypeError(`${label} must be disabled, preview, or active`);
  return value;
};

const validateFilter = (filter, label) => {
  if (!isRecord(filter)) throw new TypeError(`${label} must be an object`);
  const operator = filter.operator ?? 'equals';
  if (!['equals', 'not-equals'].includes(operator)) throw new TypeError(`${label}.operator is unsupported`);
  return { property: requireString(filter.property, `${label}.property`), operator, value: filter.value };
};

const validateNumericRule = (rule, index) => {
  const label = `numericRules[${index}]`;
  if (!isRecord(rule)) throw new TypeError(`${label} must be an object`);
  if (!['related-sum', 'related-difference-sum'].includes(rule.kind)) {
    throw new TypeError(`${label}.kind must be related-sum or related-difference-sum`);
  }
  const validated = {
    id: requireString(rule.id, `${label}.id`),
    kind: rule.kind,
    activation: requireActivation(rule.activation ?? 'disabled', `${label}.activation`),
    targetFolder: requireFolder(rule.targetFolder, `${label}.targetFolder`),
    sourceFolder: requireFolder(rule.sourceFolder, `${label}.sourceFolder`),
    relationProperty: requireString(rule.relationProperty, `${label}.relationProperty`),
    outputProperty: requireString(rule.outputProperty, `${label}.outputProperty`),
    rawProperty: rule.rawProperty ? requireString(rule.rawProperty, `${label}.rawProperty`) : null,
    displayProperty: rule.displayProperty ? requireString(rule.displayProperty, `${label}.displayProperty`) : null,
    displayDecimals: Number.isInteger(rule.displayDecimals) && rule.displayDecimals >= 0 && rule.displayDecimals <= 12 ? rule.displayDecimals : 2,
    filters: (rule.filters ?? []).map((filter, filterIndex) => validateFilter(filter, `${label}.filters[${filterIndex}]`))
  };
  if (rule.kind === 'related-sum') {
    validated.amountProperty = requireString(rule.amountProperty, `${label}.amountProperty`);
  } else {
    validated.positiveProperty = requireString(rule.positiveProperty, `${label}.positiveProperty`);
    validated.negativeProperty = requireString(rule.negativeProperty, `${label}.negativeProperty`);
  }
  return validated;
};

const validateRelationshipRule = (rule, index) => {
  const label = `relationshipRules[${index}]`;
  if (!isRecord(rule)) throw new TypeError(`${label} must be an object`);
  if (!['single-to-many', 'many-to-many'].includes(rule.kind)) throw new TypeError(`${label}.kind must be single-to-many or many-to-many`);
  if (rule.kind === 'many-to-many') {
    return {
      id: requireString(rule.id, `${label}.id`),
      kind: 'many-to-many',
      activation: requireActivation(rule.activation ?? 'disabled', `${label}.activation`),
      leftFolder: requireFolder(rule.leftFolder, `${label}.leftFolder`),
      leftProperty: requireString(rule.leftProperty, `${label}.leftProperty`),
      leftSerialization: rule.leftSerialization === 'quoted-wiki-link-list' ? 'quoted-wiki-link-list' : 'default',
      rightFolder: requireFolder(rule.rightFolder, `${label}.rightFolder`),
      rightProperty: requireString(rule.rightProperty, `${label}.rightProperty`),
      cardinality: 'many-to-many'
    };
  }
  const memberFolder = requireFolder(rule.memberFolder, `${label}.memberFolder`);
  const ownerFolder = requireFolder(rule.ownerFolder, `${label}.ownerFolder`);
  return {
    id: requireString(rule.id, `${label}.id`),
    kind: 'single-to-many',
    activation: requireActivation(rule.activation ?? 'disabled', `${label}.activation`),
    memberFolder,
    memberPaths: requireOptionalPaths(rule.memberPaths, `${label}.memberPaths`, memberFolder),
    memberProperty: requireString(rule.memberProperty, `${label}.memberProperty`),
    ownerFolder,
    ownerPaths: requireOptionalPaths(rule.ownerPaths, `${label}.ownerPaths`, ownerFolder),
    inverseProperty: requireString(rule.inverseProperty, `${label}.inverseProperty`),
    cardinality: 'zero-or-one-to-many'
  };
};

export const migrateSettings = (input) => {
  if (!isRecord(input) || Object.keys(input).length === 0) return structuredClone(DEFAULT_SETTINGS);
  if (input.schemaVersion === CURRENT_SCHEMA_VERSION) return structuredClone(input);
  if (input.schemaVersion === 0 || input.version === 0) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      enabled: Boolean(input.enabled),
      numericRules: structuredClone(input.balances ?? input.numericRules ?? []),
      relationshipRules: structuredClone(input.relations ?? input.relationshipRules ?? []),
      journal: structuredClone(input.journal ?? DEFAULT_SETTINGS.journal)
    };
  }
  throw new TypeError(`unsupported settings schema: ${input.schemaVersion}`);
};

export const validateSettings = (input) => {
  const migrated = migrateSettings(input);
  const settings = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    enabled: Boolean(migrated.enabled),
    numericRules: (migrated.numericRules ?? []).map(validateNumericRule),
    relationshipRules: (migrated.relationshipRules ?? []).map(validateRelationshipRule),
    journal: {
      enabled: migrated.journal?.enabled !== false,
      maxEntries: Number.isInteger(migrated.journal?.maxEntries) && migrated.journal.maxEntries >= 10 && migrated.journal.maxEntries <= 10000
        ? migrated.journal.maxEntries
        : DEFAULT_SETTINGS.journal.maxEntries
    }
  };
  const ids = [...settings.numericRules, ...settings.relationshipRules].map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('rule ids must be unique');
  return settings;
};
