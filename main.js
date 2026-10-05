const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const keyPattern = (property) => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:"${escaped}"|${escaped}):(?:[ \\t]*(.*))?$`);
};

const wikiLink = (value) => {
  const text = String(value).trim();
  if (!/^\[\[[^\n\r\]"]+\]\]$/.test(text)) throw new Error('unsupported wiki link value');
  return text;
};

const replaceQuotedWikiLinkList = (content, property, values) => {
  if (typeof content !== 'string' || !content.startsWith('---\n')) throw new Error('frontmatter must begin at byte zero with LF delimiters');
  if (typeof property !== 'string' || !property.trim()) throw new Error('property must be a non-empty string');
  if (!Array.isArray(values)) throw new Error('values must be an array');

  const close = content.indexOf('\n---', 4);
  if (close < 0) throw new Error('frontmatter closing delimiter is missing');
  const frontmatter = content.slice(4, close + 1);
  const lines = frontmatter.split('\n');
  const matcher = keyPattern(property);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^[ \t]/.test(lines[index])) continue;
    const match = lines[index].match(matcher);
    if (match) matches.push({ index, tail: match[1] ?? '' });
  }
  if (matches.length !== 1) throw new Error(`${property} must appear exactly once at top level`);
  const [{ index: start, tail }] = matches;
  if (tail && tail !== '[]') throw new Error(`${property} uses an unsupported inline shape`);

  let end = start + 1;
  while (end < lines.length && (/^[ \t]/.test(lines[end]) || lines[end] === '')) end += 1;
  const normalized = values.map(wikiLink);
  const replacement = normalized.length
    ? [`"${property}":`, ...normalized.map((value) => `  - "${value}"`)]
    : [`"${property}": []`];
  lines.splice(start, end - start, ...replacement);
  return `${content.slice(0, 4)}${lines.join('\n')}${content.slice(close + 1)}`;
};

const DEFAULTS = { schemaVersion: 1, enabled: false, numericRules: [], relationshipRules: [], journal: { enabled: true, maxEntries: 500 } };
const activations = new Set(['disabled', 'preview', 'active']);
const asText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};
const folder = (value, label) => {
  const result = asText(value, label).replace(/\/$/, '');
  if (result.startsWith('/') || result.includes('..') || /^[A-Za-z]:/.test(result)) throw new Error(`${label} must be vault-relative`);
  return result;
};
const optionalPaths = (value, label, root) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array when provided`);
  const paths = value.map((entry, index) => folder(entry, `${label}[${index}]`).replace(/\.md$/i, ''));
  if (new Set(paths).size !== paths.length) throw new Error(`${label} must not contain duplicates`);
  if (paths.some((entry) => entry !== root && !entry.startsWith(`${root}/`))) throw new Error(`${label} entries must be inside ${root}`);
  return paths;
};
const activation = (value, label) => {
  const result = value ?? 'disabled';
  if (!activations.has(result)) throw new Error(`${label} is invalid`);
  return result;
};
const migrate = (input) => {
  if (!input || Object.keys(input).length === 0) return structuredClone(DEFAULTS);
  if (input.schemaVersion === 1) return structuredClone(input);
  if (input.schemaVersion === 0 || input.version === 0) return {
    schemaVersion: 1,
    enabled: Boolean(input.enabled),
    numericRules: structuredClone(input.balances ?? input.numericRules ?? []),
    relationshipRules: structuredClone(input.relations ?? input.relationshipRules ?? []),
    journal: structuredClone(input.journal ?? DEFAULTS.journal)
  };
  throw new Error(`unsupported settings schema: ${input.schemaVersion}`);
};
const validate = (input) => {
  const source = migrate(input);
  const numericRules = (source.numericRules ?? []).map((rule, index) => {
    const label = `numericRules[${index}]`;
    if (!['related-sum', 'related-difference-sum'].includes(rule.kind)) throw new Error(`${label}.kind is unsupported`);
    const validated = {
      id: asText(rule.id, `${label}.id`), kind: rule.kind, activation: activation(rule.activation, `${label}.activation`),
      targetFolder: folder(rule.targetFolder, `${label}.targetFolder`), sourceFolder: folder(rule.sourceFolder, `${label}.sourceFolder`),
      relationProperty: asText(rule.relationProperty, `${label}.relationProperty`),
      outputProperty: asText(rule.outputProperty, `${label}.outputProperty`), rawProperty: rule.rawProperty ? asText(rule.rawProperty, `${label}.rawProperty`) : null,
      displayProperty: rule.displayProperty ? asText(rule.displayProperty, `${label}.displayProperty`) : null,
      displayDecimals: Number.isInteger(rule.displayDecimals) && rule.displayDecimals >= 0 && rule.displayDecimals <= 12 ? rule.displayDecimals : 2,
      filters: (rule.filters ?? []).map((filter) => ({ property: asText(filter.property, `${label}.filter.property`), operator: filter.operator ?? 'equals', value: filter.value }))
    };
    if (rule.kind === 'related-sum') validated.amountProperty = asText(rule.amountProperty, `${label}.amountProperty`);
    else {
      validated.positiveProperty = asText(rule.positiveProperty, `${label}.positiveProperty`);
      validated.negativeProperty = asText(rule.negativeProperty, `${label}.negativeProperty`);
    }
    return validated;
  });
  const relationshipRules = (source.relationshipRules ?? []).map((rule, index) => {
    const label = `relationshipRules[${index}]`;
    if (!['single-to-many', 'many-to-many'].includes(rule.kind)) throw new Error(`${label}.kind is unsupported`);
    if (rule.kind === 'many-to-many') return {
      id: asText(rule.id, `${label}.id`), kind: 'many-to-many', activation: activation(rule.activation, `${label}.activation`),
      leftFolder: folder(rule.leftFolder, `${label}.leftFolder`), leftProperty: asText(rule.leftProperty, `${label}.leftProperty`),
      leftSerialization: rule.leftSerialization === 'quoted-wiki-link-list' ? 'quoted-wiki-link-list' : 'default',
      rightFolder: folder(rule.rightFolder, `${label}.rightFolder`), rightProperty: asText(rule.rightProperty, `${label}.rightProperty`)
    };
    const memberFolder = folder(rule.memberFolder, `${label}.memberFolder`);
    const ownerFolder = folder(rule.ownerFolder, `${label}.ownerFolder`);
    return {
      id: asText(rule.id, `${label}.id`), kind: 'single-to-many', activation: activation(rule.activation, `${label}.activation`),
      memberFolder, memberPaths: optionalPaths(rule.memberPaths, `${label}.memberPaths`, memberFolder), memberProperty: asText(rule.memberProperty, `${label}.memberProperty`),
      ownerFolder, ownerPaths: optionalPaths(rule.ownerPaths, `${label}.ownerPaths`, ownerFolder), inverseProperty: asText(rule.inverseProperty, `${label}.inverseProperty`)
    };
  });
  const ids = [...numericRules, ...relationshipRules].map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) throw new Error('rule ids must be unique');
  return {
    schemaVersion: 1, enabled: Boolean(source.enabled), numericRules, relationshipRules,
    journal: { enabled: source.journal?.enabled !== false, maxEntries: Number.isInteger(source.journal?.maxEntries) ? Math.min(10000, Math.max(10, source.journal.maxEntries)) : 500 }
  };
};

const decimal = (value) => {
  const text = String(value ?? '').trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error('invalid decimal value');
  const fraction = match[3] ?? '';
  return normalize({ coefficient: (match[1] === '-' ? -1n : 1n) * BigInt(`${match[2]}${fraction}`), scale: fraction.length });
};
const normalize = ({ coefficient, scale }) => {
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale -= 1; }
  return { coefficient, scale };
};
const add = (left, right) => {
  const scale = Math.max(left.scale, right.scale);
  return normalize({ coefficient: left.coefficient * 10n ** BigInt(scale - left.scale) + right.coefficient * 10n ** BigInt(scale - right.scale), scale });
};
const decimalText = (value) => {
  const item = normalize(value); const negative = item.coefficient < 0n; const digits = (negative ? -item.coefficient : item.coefficient).toString();
  if (!item.scale) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(item.scale + 1, '0'); const point = padded.length - item.scale;
  return `${negative ? '-' : ''}${padded.slice(0, point)}.${padded.slice(point)}`;
};
const fixed = (value, scale) => {
  let item = normalize(value);
  if (item.scale > scale) {
    const divisor = 10n ** BigInt(item.scale - scale); let quotient = item.coefficient / divisor; const remainder = item.coefficient % divisor;
    if ((remainder < 0n ? -remainder : remainder) * 2n >= divisor) quotient += item.coefficient < 0n ? -1n : 1n;
    item = { coefficient: quotient, scale };
  }
  const coefficient = item.coefficient * 10n ** BigInt(scale - item.scale);
  const negative = coefficient < 0n; const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  if (!scale) return `${negative ? '-' : ''}${digits}`;
  const point = digits.length - scale; return `${negative ? '-' : ''}${digits.slice(0, point)}.${digits.slice(point)}`;
};
const notePath = (value) => String(value ?? '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
const links = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((item) => {
  const match = String(item).match(/^\[\[([^|#\]]+)/); if (!match) throw new Error('invalid wiki link value'); return notePath(match[1]);
});
const link = (path) => `[[${notePath(path)}]]`;
const unique = (values) => [...new Set(values.map(notePath).filter(Boolean))].sort();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const inFolder = (path, root) => path === `${root}.md` || path.startsWith(`${root}/`);
const matchesFilter = (properties, filter) => filter.operator === 'not-equals' ? properties[filter.property] !== filter.value : properties[filter.property] === filter.value;
const numericContribution = (rule, properties) => {
  if (rule.kind === 'related-sum') return decimal(properties[rule.amountProperty] ?? 0);
  const positive = decimal(properties[rule.positiveProperty] ?? 0);
  const negative = decimal(properties[rule.negativeProperty] ?? 0);
  return add(positive, { coefficient: -negative.coefficient, scale: negative.scale });
};

class PropertyIntegrity extends Plugin {
  async onload() {
    const data = await this.loadData() ?? {};
    this.settings = validate(data.settings ?? {});
    this.journal = Array.isArray(data.journal) ? data.journal.slice(-this.settings.journal.maxEntries) : [];
    this.acceptedStates = data.acceptedStates ?? {};
    this.undoStack = Array.isArray(data.undoStack) ? data.undoStack.slice(-10) : [];
    this.pendingBatch = data.pendingBatch ?? null;
    this.acceptCreateEvents = false;
    this.recovering = Boolean(this.pendingBatch);
    this.failures = new Map(); this.paused = new Set(); this.writing = new Set(); this.pendingPaths = new Set(); this.timer = null;
    this.addSettingTab(new PropertyIntegritySettings(this.app, this));
    this.addCommand({ id: 'preview-rules', name: 'Preview configured rules', callback: () => this.run('preview') });
    this.addCommand({ id: 'apply-active-rules', name: 'Apply active rules', callback: () => this.run('active') });
    this.addCommand({ id: 'undo-last-apply', name: 'Undo last applied change set', callback: () => this.undo() });
    this.app.workspace.onLayoutReady(async () => {
      if (this.pendingBatch) {
        try {
          await this.restoreChanges(this.pendingBatch.writes);
          this.acceptedStates = this.pendingBatch.acceptedStates ?? this.acceptedStates;
          this.pendingBatch = null;
          await this.persist();
        } catch (error) {
          this.failure('recovery', Object.assign(error, { code: error.code ?? 'ROLLBACK_PENDING' }));
          await this.persist();
          new Notice(`Property Integrity recovery pending: ${error.message}`);
          console.error('Property Integrity recovery', error);
          return;
        }
      }
      this.recovering = false;
      this.acceptCreateEvents = true;
    });
    this.registerEvent(this.app.vault.on('create', (file) => { if (this.acceptCreateEvents) this.queue(file?.path); }));
    this.registerEvent(this.app.vault.on('modify', (file) => this.queue(file?.path)));
    this.registerEvent(this.app.vault.on('rename', (file) => this.queue(file?.path)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.queue(file?.path)));
  }
  onunload() { if (this.timer) window.clearTimeout(this.timer); }
  queue(path) {
    if (!this.settings.enabled || this.recovering || !path || this.writing.has(path)) return;
    this.pendingPaths.add(path);
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const paths = [...this.pendingPaths]; this.pendingPaths.clear(); this.timer = null; this.run('active', paths);
    }, 350);
  }
  files(root, allowedPaths = null) {
    const allowed = allowedPaths ? new Set(allowedPaths) : null;
    return this.app.vault.getMarkdownFiles().filter((file) => inFolder(file.path, root) && (!allowed || allowed.has(notePath(file.path))));
  }
  properties(file) { return this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}; }
  quotedWikiLinkProperties() {
    return new Set(this.settings.relationshipRules
      .filter((rule) => rule.kind === 'many-to-many' && rule.leftSerialization === 'quoted-wiki-link-list')
      .map((rule) => rule.leftProperty));
  }
  async writeProperties(file, properties) {
    const keys = Object.keys(properties);
    const quotedKeys = keys.filter((key) => this.quotedWikiLinkProperties().has(key));
    if (!quotedKeys.length) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => Object.assign(frontmatter, properties));
      return;
    }
    if (keys.length !== 1 || quotedKeys.length !== 1 || !Array.isArray(properties[quotedKeys[0]])) {
      throw new Error('quoted wiki-link property requires an isolated list write');
    }
    await this.app.vault.process(file, (content) => replaceQuotedWikiLinkList(content, quotedKeys[0], properties[quotedKeys[0]]));
  }
  async run(mode, changedPath = null) {
    const changedPaths = changedPath === null ? null : Array.isArray(changedPath) ? changedPath : [changedPath];
    const changedIn = (root, allowedPaths = null) => changedPaths?.some((path) => inFolder(path, root) && (!allowedPaths || allowedPaths.includes(notePath(path))));
    const plans = []; const acceptedStatesBefore = structuredClone(this.acceptedStates);
    const relationshipRuleIds = new Set(this.settings.relationshipRules.map((rule) => rule.id));
    const relationshipWrites = new Set();
    try {
      for (const rule of this.settings.numericRules) {
        if (rule.activation === 'disabled' || this.paused.has(rule.id)) continue;
        if (changedPaths && !changedIn(rule.sourceFolder) && !changedIn(rule.targetFolder)) continue;
        try { plans.push(...this.numericPlans(rule)); }
        catch (error) {
          this.failure(rule.id, error); new Notice(`Property Integrity stopped ${rule.id}: ${error.message}`); console.error('Property Integrity', error);
        }
      }
      for (const rule of this.settings.relationshipRules) {
        if (rule.activation === 'disabled' || this.paused.has(rule.id)) continue;
        const firstFolder = rule.kind === 'many-to-many' ? rule.leftFolder : rule.memberFolder;
        const secondFolder = rule.kind === 'many-to-many' ? rule.rightFolder : rule.ownerFolder;
        const firstPaths = rule.kind === 'many-to-many' ? null : rule.memberPaths;
        const secondPaths = rule.kind === 'many-to-many' ? null : rule.ownerPaths;
        if (changedPaths && !changedIn(firstFolder, firstPaths) && !changedIn(secondFolder, secondPaths)) continue;
        const acceptedBeforeRule = structuredClone(this.acceptedStates[rule.id]);
        try { plans.push(...this.relationshipPlans(rule, changedPaths)); }
        catch (error) {
          acceptedBeforeRule === undefined ? delete this.acceptedStates[rule.id] : this.acceptedStates[rule.id] = acceptedBeforeRule;
          this.failure(rule.id, error); new Notice(`Property Integrity stopped ${rule.id}: ${error.message}`); console.error('Property Integrity', error);
        }
      }
      const activePlans = plans.filter((plan) => mode === 'active' && plan.activation === 'active');
      if (!activePlans.length) {
        for (const plan of plans) this.log(plan, 'preview');
        new Notice(`Property Integrity preview: ${plans.length} change set${plans.length === 1 ? '' : 's'}`);
        await this.persist(); return;
      }
      const undo = [];
      for (const plan of activePlans) {
        for (const write of plan.writes) {
          const file = this.app.vault.getAbstractFileByPath(write.path); if (!file) throw new Error(`missing file: ${write.path}`);
          const current = this.properties(file);
          for (const [property, expected] of Object.entries(write.precondition ?? {})) {
            if (!same(current[property], expected)) throw Object.assign(new Error(`stale preimage at ${write.path}#${property}`), { code: 'STALE', ruleId: plan.ruleId });
          }
          const previous = Object.fromEntries(Object.keys(write.properties).map((property) => [property,
            Object.prototype.hasOwnProperty.call(current, property) ? { exists: true, value: current[property] } : { exists: false }
          ]));
          undo.push({ path: write.path, content: await this.app.vault.read(file), properties: previous });
        }
      }
      this.pendingBatch = { writes: undo, acceptedStates: acceptedStatesBefore };
      await this.persist();
      for (const plan of activePlans) {
        for (const write of plan.writes) {
          const file = this.app.vault.getAbstractFileByPath(write.path);
          this.writing.add(write.path);
          await this.writeProperties(file, write.properties);
          this.writing.delete(write.path);
          if (relationshipRuleIds.has(plan.ruleId)) relationshipWrites.add(write.path);
        }
        this.log(plan, 'applied'); this.failures.delete(plan.ruleId);
      }
      this.undoStack.push(this.pendingBatch); this.undoStack = this.undoStack.slice(-10); this.pendingBatch = null; await this.persist();
      for (const path of relationshipWrites) this.queue(path);
      new Notice(`Property Integrity applied ${activePlans.length} change set${activePlans.length === 1 ? '' : 's'}`);
    } catch (error) {
      if (this.pendingBatch) {
        try {
          await this.restoreChanges(this.pendingBatch.writes);
          this.acceptedStates = this.pendingBatch.acceptedStates ?? acceptedStatesBefore;
          this.pendingBatch = null;
        } catch (recoveryError) {
          error = Object.assign(new Error(`${error.message}; rollback pending: ${recoveryError.message}`), { code: 'ROLLBACK_PENDING', ruleId: error.ruleId });
        }
      }
      this.acceptedStates = acceptedStatesBefore;
      this.failure(error.ruleId ?? 'runtime', error);
      await this.persist(); new Notice(`Property Integrity stopped: ${error.message}`); console.error('Property Integrity', error);
    } finally { this.writing.clear(); }
  }
  async restoreChanges(changes) {
    for (const change of [...changes].reverse()) {
      const file = this.app.vault.getAbstractFileByPath(change.path); if (!file) continue;
      this.writing.add(change.path);
      if (typeof change.content === 'string') {
        await this.app.vault.process(file, () => change.content);
        this.writing.delete(change.path);
        continue;
      }
      const properties = {};
      const removals = [];
      for (const [property, snapshot] of Object.entries(change.properties)) {
        if (snapshot && typeof snapshot === 'object' && Object.prototype.hasOwnProperty.call(snapshot, 'exists')) {
          snapshot.exists ? properties[property] = snapshot.value : removals.push(property);
        } else {
          snapshot === undefined ? removals.push(property) : properties[property] = snapshot;
        }
      }
      if (removals.length) {
        const quoted = this.quotedWikiLinkProperties();
        if (removals.some((property) => quoted.has(property)) || Object.keys(properties).some((property) => quoted.has(property))) {
          throw new Error('undo cannot combine a quoted wiki-link property with property removal');
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          Object.assign(frontmatter, properties);
          for (const property of removals) delete frontmatter[property];
        });
      } else await this.writeProperties(file, properties);
      this.writing.delete(change.path);
    }
  }
  failure(ruleId, error) {
    const signature = `${error.code ?? 'ERROR'}:${error.message}`; const previous = this.failures.get(ruleId);
    const count = previous?.signature === signature ? previous.count + 1 : 1; this.failures.set(ruleId, { signature, count });
    if (count >= 3) this.paused.add(ruleId);
    this.journal.push({ timestamp: new Date().toISOString(), ruleId, status: count >= 3 ? 'failed' : 'conflict', code: error.code ?? 'ERROR', paths: [], properties: [], preHashes: {}, postHashes: {} });
    this.journal = this.journal.slice(-this.settings.journal.maxEntries);
  }
  numericPlans(rule) {
    const sources = this.files(rule.sourceFolder); const plans = [];
    for (const target of this.files(rule.targetFolder)) {
      let total = { coefficient: 0n, scale: 0 };
      for (const source of sources) {
        const properties = this.properties(source);
        if (!rule.filters.every((filter) => matchesFilter(properties, filter))) continue;
        if (!links(properties[rule.relationProperty]).includes(notePath(target.path))) continue;
        total = add(total, numericContribution(rule, properties));
      }
      const exact = decimalText(total); const current = this.properties(target); const properties = { [rule.outputProperty]: Number(exact) };
      if (rule.rawProperty) properties[rule.rawProperty] = exact;
      if (rule.displayProperty) properties[rule.displayProperty] = fixed(total, rule.displayDecimals);
      if (Object.entries(properties).some(([key, value]) => String(current[key] ?? '') !== String(value))) {
        const precondition = Object.fromEntries(Object.keys(properties).map((property) => [property, current[property]]));
        plans.push({ ruleId: rule.id, activation: rule.activation, writes: [{ path: target.path, properties, precondition }] });
      }
    }
    return plans;
  }
  relationshipPlans(rule, changedPath = null) {
    if (rule.kind === 'many-to-many') return this.manyToManyPlans(rule, changedPath);
    const owners = this.files(rule.ownerFolder, rule.ownerPaths); const ownerPaths = owners.map((file) => notePath(file.path)); const plans = [];
    for (const member of this.files(rule.memberFolder, rule.memberPaths)) {
      const memberPath = notePath(member.path); const memberValues = links(this.properties(member)[rule.memberProperty]);
      if (memberValues.length > 1) throw Object.assign(new Error(`${rule.memberProperty} exceeds cardinality`), { code: 'CARDINALITY', ruleId: rule.id });
      const memberOwner = memberValues[0] ?? null;
      if (memberOwner && !ownerPaths.includes(memberOwner)) throw Object.assign(new Error(`relationship target is outside ${rule.ownerFolder}`), { code: 'OUT_OF_SCOPE', ruleId: rule.id });
      const ownerMembership = owners.filter((owner) => links(this.properties(owner)[rule.inverseProperty]).includes(memberPath)).map((owner) => notePath(owner.path)).sort();
      const current = { memberOwner, ownerMembership }; const baseline = this.acceptedStates[rule.id]?.[memberPath];
      if (!baseline) {
        if (!same(ownerMembership, memberOwner ? [memberOwner] : [])) throw Object.assign(new Error('relationship is inconsistent before activation'), { code: 'INITIAL_INCONSISTENCY', ruleId: rule.id });
        this.acceptedStates[rule.id] ??= {}; this.acceptedStates[rule.id][memberPath] = current; continue;
      }
      const memberChanged = memberOwner !== baseline.memberOwner; const ownersChanged = !same(ownerMembership, baseline.ownerMembership);
      if (!memberChanged && !ownersChanged) continue;
      if (memberChanged && ownersChanged) {
        if (!same(ownerMembership, memberOwner ? [memberOwner] : [])) throw Object.assign(new Error('both endpoints changed inconsistently'), { code: 'OPPOSITE_ENDPOINT_CONFLICT', ruleId: rule.id });
        this.acceptedStates[rule.id][memberPath] = current; continue;
      }
      const writes = [];
      if (memberChanged) {
        for (const owner of owners) {
          const path = notePath(owner.path); const values = unique(links(this.properties(owner)[rule.inverseProperty]).filter((item) => item !== memberPath));
          const desired = path === memberOwner ? unique([...values, memberPath]) : values;
          const before = this.properties(owner)[rule.inverseProperty];
          if (!same(desired, unique(links(before)))) writes.push({ path: owner.path, properties: { [rule.inverseProperty]: desired.map(link) }, precondition: { [rule.inverseProperty]: before } });
        }
      } else {
        if (ownerMembership.length > 1) throw Object.assign(new Error('member appears in multiple owners'), { code: 'CARDINALITY', ruleId: rule.id });
        writes.push({ path: member.path, properties: { [rule.memberProperty]: ownerMembership.length ? [link(ownerMembership[0])] : [] }, precondition: { [rule.memberProperty]: this.properties(member)[rule.memberProperty] } });
      }
      const accepted = memberChanged ? { memberOwner, ownerMembership: memberOwner ? [memberOwner] : [] } : { memberOwner: ownerMembership[0] ?? null, ownerMembership };
      this.acceptedStates[rule.id][memberPath] = accepted;
      plans.push({ ruleId: rule.id, activation: rule.activation, writes });
    }
    return plans;
  }
  manyToManyPlans(rule, changedPaths = null) {
    const rights = this.files(rule.rightFolder); const rightPaths = rights.map((file) => notePath(file.path)); const plans = [];
    const allLefts = this.files(rule.leftFolder);
    const changedLefts = changedPaths?.filter((path) => inFolder(path, rule.leftFolder)) ?? [];
    const changedRight = changedPaths?.some((path) => inFolder(path, rule.rightFolder));
    const lefts = changedPaths && changedLefts.length && !changedRight
      ? allLefts.filter((file) => changedLefts.includes(file.path))
      : allLefts;
    for (const left of lefts) {
      const leftPath = notePath(left.path);
      const rawLeftRights = links(this.properties(left)[rule.leftProperty]);
      const leftRights = unique(rawLeftRights);
      if (rawLeftRights.length !== leftRights.length) throw Object.assign(new Error(`duplicate relationship reference in ${left.path}`), { code: 'DUPLICATE', ruleId: rule.id });
      for (const right of leftRights) {
        if (!rightPaths.includes(right)) throw Object.assign(new Error(`relationship target is outside ${rule.rightFolder}`), { code: 'OUT_OF_SCOPE', ruleId: rule.id });
      }
      const rightMembership = rights
        .filter((right) => {
          const rawValues = links(this.properties(right)[rule.rightProperty]);
          if (rawValues.length !== unique(rawValues).length) throw Object.assign(new Error(`duplicate relationship reference in ${right.path}`), { code: 'DUPLICATE', ruleId: rule.id });
          return rawValues.includes(leftPath);
        })
        .map((right) => notePath(right.path)).sort();
      const current = { leftRights, rightMembership };
      const baseline = this.acceptedStates[rule.id]?.[leftPath];
      if (!baseline) {
        if (!same(leftRights, rightMembership)) throw Object.assign(new Error('relationship is inconsistent before activation'), { code: 'INITIAL_INCONSISTENCY', ruleId: rule.id });
        this.acceptedStates[rule.id] ??= {}; this.acceptedStates[rule.id][leftPath] = current; continue;
      }
      const leftChanged = !same(leftRights, baseline.leftRights);
      const rightsChanged = !same(rightMembership, baseline.rightMembership);
      if (!leftChanged && !rightsChanged) continue;
      if (leftChanged && rightsChanged) {
        if (!same(leftRights, rightMembership)) throw Object.assign(new Error('both endpoints changed inconsistently'), { code: 'OPPOSITE_ENDPOINT_CONFLICT', ruleId: rule.id });
        this.acceptedStates[rule.id][leftPath] = current;
        if (rule.leftSerialization === 'quoted-wiki-link-list') {
          const before = this.properties(left)[rule.leftProperty];
          plans.push({
            ruleId: rule.id,
            activation: rule.activation,
            writes: [{ path: left.path, properties: { [rule.leftProperty]: leftRights.map(link) }, precondition: { [rule.leftProperty]: before } }]
          });
        }
        continue;
      }
      const writes = [];
      if (leftChanged) {
        if (rule.leftSerialization === 'quoted-wiki-link-list') {
          const before = this.properties(left)[rule.leftProperty];
          writes.push({ path: left.path, properties: { [rule.leftProperty]: leftRights.map(link) }, precondition: { [rule.leftProperty]: before } });
        }
        for (const right of rights) {
          const path = notePath(right.path);
          const before = this.properties(right)[rule.rightProperty];
          const retained = unique(links(before).filter((item) => item !== leftPath));
          const desired = leftRights.includes(path) ? unique([...retained, leftPath]) : retained;
          if (!same(desired, unique(links(before)))) writes.push({ path: right.path, properties: { [rule.rightProperty]: desired.map(link) }, precondition: { [rule.rightProperty]: before } });
        }
      } else {
        const before = this.properties(left)[rule.leftProperty];
        writes.push({ path: left.path, properties: { [rule.leftProperty]: rightMembership.map(link) }, precondition: { [rule.leftProperty]: before } });
      }
      const accepted = leftChanged ? { leftRights, rightMembership: leftRights } : { leftRights: rightMembership, rightMembership };
      this.acceptedStates[rule.id][leftPath] = accepted;
      plans.push({ ruleId: rule.id, activation: rule.activation, writes });
    }
    return plans;
  }
  log(plan, status) {
    if (!this.settings.journal.enabled) return;
    this.journal.push({ timestamp: new Date().toISOString(), ruleId: plan.ruleId, status, code: null,
      paths: [...new Set(plan.writes.map((write) => write.path))].sort(),
      properties: [...new Set(plan.writes.flatMap((write) => Object.keys(write.properties)))].sort(), preHashes: {}, postHashes: {} });
    this.journal = this.journal.slice(-this.settings.journal.maxEntries);
  }
  async undo() {
    const entry = this.undoStack.pop(); if (!entry) { new Notice('Property Integrity: nothing to undo'); return; }
    const changes = Array.isArray(entry) ? entry : entry.writes;
    await this.restoreChanges(changes);
    if (!Array.isArray(entry) && entry.acceptedStates) this.acceptedStates = entry.acceptedStates;
    await this.persist(); new Notice('Property Integrity restored the last applied change set');
  }
  async persist() { await this.saveData({ settings: this.settings, journal: this.journal, acceptedStates: this.acceptedStates, undoStack: this.undoStack, pendingBatch: this.pendingBatch }); }
}

class PropertyIntegritySettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty(); containerEl.createEl('h2', { text: 'Property Integrity' });
    containerEl.createEl('p', { text: 'Rules are disabled by default. Use preview before changing a rule to active.' });
    new Setting(containerEl).setName('Enable runtime').setDesc('Allows active rules to respond to local note changes.').addToggle((toggle) => toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => { this.plugin.settings.enabled = value; await this.plugin.persist(); }));
    new Setting(containerEl).setName('Rule configuration').setDesc('JSON arrays for numericRules and relationshipRules.').addTextArea((area) => {
      area.setValue(JSON.stringify({ numericRules: this.plugin.settings.numericRules, relationshipRules: this.plugin.settings.relationshipRules }, null, 2));
      area.inputEl.rows = 18; area.inputEl.cols = 70;
      area.onChange((value) => { this.draft = value; });
    });
    new Setting(containerEl).addButton((button) => button.setButtonText('Validate and save').setCta().onClick(async () => {
      try {
        const parsed = JSON.parse(this.draft ?? JSON.stringify({ numericRules: this.plugin.settings.numericRules, relationshipRules: this.plugin.settings.relationshipRules }));
        this.plugin.settings = validate({ ...this.plugin.settings, ...parsed }); await this.plugin.persist(); new Notice('Property Integrity settings saved'); this.display();
      } catch (error) { new Notice(`Property Integrity settings rejected: ${error.message}`); }
    }));
  }
}

module.exports = PropertyIntegrity;
