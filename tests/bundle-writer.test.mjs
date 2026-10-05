import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const bundlePath = resolve(import.meta.dirname, '../main.js');
const bundle = new Module(bundlePath);
bundle.filename = bundlePath;
bundle.paths = Module._nodeModulePaths(import.meta.dirname);
bundle._compile(readFileSync(bundlePath, 'utf8'), bundlePath.replace(/\.js$/, '.cjs'));
const PropertyIntegrity = bundle.exports;
Module._load = originalLoad;

const note = `---\nComponents: []\n"Related Items":\n  - "[[Catalog/Old]]"\nAmount Exact: "20.0000"\n---\n\n# Record\n`;
const quotedSettings = { relationshipRules: [{ kind: 'many-to-many', leftProperty: 'Related Items', leftSerialization: 'quoted-wiki-link-list' }] };

test('generated bundle subscribes to every lifecycle event used by numeric discovery', async () => {
  const events = [];
  let layoutReady;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.app = {
    vault: { on: (name) => { events.push(name); return { name }; } },
    workspace: { onLayoutReady: (callback) => { layoutReady = callback; } }
  };
  plugin.loadData = async () => ({});
  plugin.addSettingTab = () => {};
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  await plugin.onload();
  assert.deepEqual(events, ['create', 'modify', 'rename', 'delete']);
  assert.equal(plugin.acceptCreateEvents, false);
  await layoutReady();
  assert.equal(plugin.acceptCreateEvents, true);
});

test('single-to-many path allowlists constrain file discovery and event handling', async () => {
  const files = [
    { path: 'Work/Items/Allowed.md' }, { path: 'Work/Items/Excluded.md' },
    { path: 'Work/Groups/One.md' }, { path: 'Work/Groups/Excluded.md' }
  ];
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.app = { vault: { getMarkdownFiles: () => files } };
  assert.deepEqual(plugin.files('Work/Items', ['Work/Items/Allowed']).map((file) => file.path), ['Work/Items/Allowed.md']);
  assert.deepEqual(plugin.files('Work/Groups', ['Work/Groups/One']).map((file) => file.path), ['Work/Groups/One.md']);

  let relationshipCalls = 0;
  plugin.settings = {
    enabled: true, numericRules: [], journal: { enabled: true, maxEntries: 10 },
    relationshipRules: [{
      id: 'bounded', kind: 'single-to-many', activation: 'active', memberFolder: 'Work/Items', memberPaths: ['Work/Items/Allowed'],
      memberProperty: 'Group', ownerFolder: 'Work/Groups', ownerPaths: ['Work/Groups/One'], inverseProperty: 'Items'
    }]
  };
  plugin.acceptedStates = {}; plugin.journal = []; plugin.failures = new Map(); plugin.paused = new Set(); plugin.writing = new Set(); plugin.undoStack = []; plugin.pendingBatch = null;
  plugin.relationshipPlans = () => { relationshipCalls += 1; return []; };
  plugin.persist = async () => {};
  await plugin.run('active', ['Work/Items/Excluded.md']);
  assert.equal(relationshipCalls, 0);
  await plugin.run('active', ['Work/Items/Allowed.md']);
  assert.equal(relationshipCalls, 1);
});

test('generated bundle routes configured quoted lists through Vault.process and preserves unrelated bytes', async () => {
  let content = note; let processCalls = 0; let frontmatterCalls = 0;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.settings = quotedSettings;
  plugin.app = {
    vault: { process: async (_file, transform) => { processCalls += 1; content = transform(content); } },
    fileManager: { processFrontMatter: async () => { frontmatterCalls += 1; } }
  };
  await plugin.writeProperties({ path: 'Record.md' }, { 'Related Items': ['[[Catalog/New]]'] });
  assert.equal(processCalls, 1);
  assert.equal(frontmatterCalls, 0);
  assert.match(content, /^"Related Items":\n  - "\[\[Catalog\/New\]\]"$/m);
  assert.match(content, /^Components: \[\]$/m);
  assert.match(content, /^Amount Exact: "20\.0000"$/m);
});

test('generated bundle restores the original quoted-list value through the same path', async () => {
  let content = note;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.settings = quotedSettings;
  plugin.app = {
    vault: { process: async (_file, transform) => { content = transform(content); } },
    fileManager: { processFrontMatter: async () => { throw new Error('wrong writer'); } }
  };
  await plugin.writeProperties({}, { 'Related Items': ['[[Catalog/New]]'] });
  await plugin.writeProperties({}, { 'Related Items': ['[[Catalog/Old]]'] });
  assert.equal(content, note);
});

test('generated bundle keeps ordinary writes on processFrontMatter and rejects mixed quoted-list writes', async () => {
  let processCalls = 0; let frontmatterCalls = 0;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.settings = quotedSettings;
  plugin.app = {
    vault: { process: async () => { processCalls += 1; } },
    fileManager: { processFrontMatter: async (_file, transform) => { frontmatterCalls += 1; const value = {}; transform(value); assert.equal(value.Status, 'Complete'); } }
  };
  await plugin.writeProperties({}, { Status: 'Complete' });
  await assert.rejects(() => plugin.writeProperties({}, { Status: 'Complete', 'Related Items': [] }), /isolated list write/);
  assert.equal(processCalls, 0);
  assert.equal(frontmatterCalls, 1);
});

test('configured left-endpoint edits schedule quote canonicalization while default relations do not', () => {
  const left = { path: 'Records/Transactions/Transaction One.md' };
  const oldRight = { path: 'Records/Organizations/Old.md' };
  const newRight = { path: 'Records/Organizations/New.md' };
  const leftPath = 'Records/Transactions/Transaction One';
  const oldPath = 'Records/Organizations/Old';
  const newPath = 'Records/Organizations/New';
  const values = new Map([
    [left.path, { 'Related Items': [`[[${newPath}|New]]`], Components: [`[[${newPath}|New]]`] }],
    [oldRight.path, { Transactions: [`[[${leftPath}|Transaction One]]`] }],
    [newRight.path, { Transactions: [] }]
  ]);
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.files = (folder) => folder.endsWith('Transactions') ? [left] : [oldRight, newRight];
  plugin.properties = (file) => values.get(file.path);
  plugin.acceptedStates = {
    quoted: { [leftPath]: { leftRights: [oldPath], rightMembership: [oldPath] } },
    generic: { [leftPath]: { leftRights: [oldPath], rightMembership: [oldPath] } }
  };
  const baseRule = {
    kind: 'many-to-many', activation: 'active', leftFolder: 'Records/Transactions',
    rightFolder: 'Records/Organizations', rightProperty: 'Transactions'
  };
  const quoted = plugin.manyToManyPlans({ ...baseRule, id: 'quoted', leftProperty: 'Related Items', leftSerialization: 'quoted-wiki-link-list' }, [left.path]);
  assert.deepEqual(quoted[0].writes.map((write) => write.path), [left.path, oldRight.path, newRight.path]);
  assert.deepEqual(quoted[0].writes[0].properties['Related Items'], [`[[${newPath}]]`]);

  const generic = plugin.manyToManyPlans({ ...baseRule, id: 'generic', leftProperty: 'Components' }, [left.path]);
  assert.deepEqual(generic[0].writes.map((write) => write.path), [oldRight.path, newRight.path]);
});

test('consistent simultaneous edits canonicalize only a configured quoted left key', () => {
  const left = { path: 'Records/Transactions/Transaction One.md' };
  const oldRight = { path: 'Records/Organizations/Old.md' };
  const newRight = { path: 'Records/Organizations/New.md' };
  const leftPath = 'Records/Transactions/Transaction One';
  const oldPath = 'Records/Organizations/Old';
  const newPath = 'Records/Organizations/New';
  const values = new Map([
    [left.path, { 'Related Items': [`[[${newPath}|New]]`], Components: [`[[${newPath}|New]]`] }],
    [oldRight.path, { Transactions: [] }],
    [newRight.path, { Transactions: [`[[${leftPath}|Transaction One]]`] }]
  ]);
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.files = (folder) => folder.endsWith('Transactions') ? [left] : [oldRight, newRight];
  plugin.properties = (file) => values.get(file.path);
  plugin.acceptedStates = {
    quoted: { [leftPath]: { leftRights: [oldPath], rightMembership: [oldPath] } },
    generic: { [leftPath]: { leftRights: [oldPath], rightMembership: [oldPath] } }
  };
  const baseRule = {
    kind: 'many-to-many', activation: 'active', leftFolder: 'Records/Transactions',
    rightFolder: 'Records/Organizations', rightProperty: 'Transactions'
  };

  const quoted = plugin.manyToManyPlans({ ...baseRule, id: 'quoted', leftProperty: 'Related Items', leftSerialization: 'quoted-wiki-link-list' }, [left.path, newRight.path]);
  assert.deepEqual(quoted[0].writes, [{
    path: left.path,
    properties: { 'Related Items': [`[[${newPath}]]`] },
    precondition: { 'Related Items': [`[[${newPath}|New]]`] }
  }]);

  const generic = plugin.manyToManyPlans({ ...baseRule, id: 'generic', leftProperty: 'Components' }, [left.path, newRight.path]);
  assert.deepEqual(generic, []);
});

test('active runtime fails closed when a write preimage is stale', async () => {
  const left = { path: 'Records/Transactions/Transaction One.md' };
  let writes = 0;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.settings = {
    enabled: true,
    numericRules: [],
    relationshipRules: [{
      id: 'quoted', kind: 'many-to-many', activation: 'active',
      leftFolder: 'Records/Transactions', leftProperty: 'Related Items', leftSerialization: 'quoted-wiki-link-list',
      rightFolder: 'Records/Organizations', rightProperty: 'Transactions'
    }],
    journal: { enabled: true, maxEntries: 10 }
  };
  plugin.acceptedStates = { quoted: { frozen: true } };
  plugin.journal = [];
  plugin.failures = new Map();
  plugin.paused = new Set();
  plugin.writing = new Set();
  plugin.undoStack = [];
  plugin.app = { vault: { getAbstractFileByPath: () => left } };
  plugin.properties = () => ({ 'Related Items': ['[[Catalog/Current]]'] });
  plugin.relationshipPlans = () => [{
    ruleId: 'quoted', activation: 'active',
    writes: [{
      path: left.path,
      properties: { 'Related Items': ['[[Catalog/Desired]]'] },
      precondition: { 'Related Items': ['[[Catalog/Expected]]'] }
    }]
  }];
  plugin.writeProperties = async () => { writes += 1; };
  plugin.persist = async () => {};

  const originalError = console.error;
  console.error = () => {};
  try {
    await plugin.run('active', [left.path]);
  } finally {
    console.error = originalError;
  }

  assert.equal(writes, 0);
  assert.deepEqual(plugin.acceptedStates, { quoted: { frozen: true } });
  assert.equal(plugin.journal.at(-1).status, 'conflict');
  assert.equal(plugin.journal.at(-1).code, 'STALE');
  assert.equal(plugin.failures.get('quoted').count, 1);
});

test('active runtime rolls back an interrupted multi-file batch before returning', async () => {
  const files = new Map([
    ['Records/Accounts/Checking.md', { path: 'Records/Accounts/Checking.md' }],
    ['Records/Accounts/Savings.md', { path: 'Records/Accounts/Savings.md' }]
  ]);
  const states = new Map([
    ['Records/Accounts/Checking.md', { Balance: 10 }],
    ['Records/Accounts/Savings.md', { Balance: 20 }]
  ]);
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.settings = {
    enabled: true,
    numericRules: [{ id: 'balances', activation: 'active', sourceFolder: 'Records/Transactions', targetFolder: 'Records/Accounts' }],
    relationshipRules: [],
    journal: { enabled: true, maxEntries: 10 }
  };
  plugin.acceptedStates = { balances: { stable: true } };
  plugin.journal = [];
  plugin.failures = new Map();
  plugin.paused = new Set();
  plugin.writing = new Set();
  plugin.undoStack = [];
  plugin.pendingBatch = null;
  plugin.app = { vault: {
    getAbstractFileByPath: (path) => files.get(path),
    read: async (file) => JSON.stringify(states.get(file.path)),
    process: async (file, transform) => { states.set(file.path, JSON.parse(transform(JSON.stringify(states.get(file.path))))); }
  } };
  plugin.properties = (file) => states.get(file.path);
  plugin.numericPlans = () => [{
    ruleId: 'balances', activation: 'active', writes: [
      { path: 'Records/Accounts/Checking.md', properties: { Balance: 11 } },
      { path: 'Records/Accounts/Savings.md', properties: { Balance: 21 } }
    ]
  }];
  let writeCalls = 0;
  plugin.writeProperties = async (file, properties) => {
    writeCalls += 1;
    if (writeCalls === 2) throw new Error('simulated interruption');
    Object.assign(states.get(file.path), properties);
  };
  const persisted = [];
  plugin.persist = async () => persisted.push(structuredClone({ pendingBatch: plugin.pendingBatch, undoStack: plugin.undoStack }));

  const originalError = console.error;
  console.error = () => {};
  try {
    await plugin.run('active', ['Records/Transactions/Test.md']);
  } finally {
    console.error = originalError;
  }

  assert.equal(writeCalls, 2);
  assert.deepEqual(states.get('Records/Accounts/Checking.md'), { Balance: 10 });
  assert.deepEqual(states.get('Records/Accounts/Savings.md'), { Balance: 20 });
  assert.equal(plugin.pendingBatch, null);
  assert.deepEqual(plugin.undoStack, []);
  assert.deepEqual(plugin.acceptedStates, { balances: { stable: true } });
  assert.equal(plugin.journal.at(-1).status, 'conflict');
  assert.ok(persisted.some((entry) => entry.pendingBatch?.writes.length === 2));
  assert.equal(persisted.at(-1).pendingBatch, null);
});

test('startup restores a persisted pending batch at layout-ready while suppressing vault events', async () => {
  const files = new Map([
    ['Records/Accounts/Checking.md', { path: 'Records/Accounts/Checking.md' }],
    ['Records/Accounts/Savings.md', { path: 'Records/Accounts/Savings.md' }]
  ]);
  const states = new Map([
    ['Records/Accounts/Checking.md', { Balance: 999 }],
    ['Records/Accounts/Savings.md', { Balance: 20 }]
  ]);
  const order = [];
  let saved;
  let layoutReady;
  const plugin = Object.create(PropertyIntegrity.prototype);
  plugin.app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path),
      on: (name) => { order.push(`on:${name}`); return { name }; }
    },
    fileManager: {
      processFrontMatter: async (file, transform) => {
        order.push(`restore:${file.path}`);
        transform(states.get(file.path));
      }
    },
    workspace: { onLayoutReady: (callback) => { layoutReady = callback; } }
  };
  plugin.loadData = async () => ({
    settings: {},
    acceptedStates: { balances: { changed: true } },
    pendingBatch: {
      writes: [
        { path: 'Records/Accounts/Checking.md', properties: { Balance: { exists: true, value: 10 } } },
        { path: 'Records/Accounts/Savings.md', properties: { Balance: { exists: true, value: 20 } } }
      ],
      acceptedStates: { balances: { stable: true } }
    }
  });
  plugin.saveData = async (data) => { saved = structuredClone(data); };
  plugin.addSettingTab = () => {};
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};

  await plugin.onload();

  assert.equal(plugin.recovering, true);
  plugin.queue('Records/Accounts/Checking.md');
  assert.equal(plugin.pendingPaths.size, 0);
  await layoutReady();

  assert.deepEqual(states.get('Records/Accounts/Checking.md'), { Balance: 10 });
  assert.deepEqual(states.get('Records/Accounts/Savings.md'), { Balance: 20 });
  assert.deepEqual(plugin.acceptedStates, { balances: { stable: true } });
  assert.equal(plugin.pendingBatch, null);
  assert.equal(plugin.recovering, false);
  assert.equal(saved.pendingBatch, null);
  assert.ok(order.indexOf('on:create') < order.indexOf('restore:Records/Accounts/Checking.md'));
  assert.ok(order.indexOf('on:create') < order.indexOf('restore:Records/Accounts/Savings.md'));
});
