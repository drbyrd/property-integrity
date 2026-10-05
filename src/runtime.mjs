import { createJournalEntry, appendBoundedJournal } from './journal.mjs';
import { validateSettings } from './settings.mjs';

export class IntegrityRuntime {
  constructor({ engine, adapter, now = () => new Date().toISOString() }) {
    this.engine = engine;
    this.adapter = adapter;
    this.now = now;
    this.settings = null;
    this.unsubscribe = null;
    this.journal = [];
    this.internalPaths = new Set();
    this.failures = new Map();
    this.pausedRules = new Set();
  }

  async start(input) {
    await this.stop();
    this.settings = validateSettings(input);
    if (!this.settings.enabled) return { started: false, reason: 'disabled' };
    this.unsubscribe = this.adapter.subscribe((event) => this.handle(event));
    return { started: true };
  }

  async stop() {
    if (this.unsubscribe) await this.unsubscribe();
    this.unsubscribe = null;
    this.internalPaths.clear();
  }

  async handle(event) {
    if (!this.settings?.enabled || this.internalPaths.has(event.path)) return { status: 'ignored' };
    const plans = await this.engine.plan(this.settings, event);
    const results = [];
    for (const plan of plans) results.push(await this.execute(plan));
    return { status: 'processed', results };
  }

  async execute(plan) {
    const rule = [...this.settings.numericRules, ...this.settings.relationshipRules].find((candidate) => candidate.id === plan.ruleId);
    if (!rule || rule.activation === 'disabled' || this.pausedRules.has(plan.ruleId)) return { status: 'ignored', ruleId: plan.ruleId };
    if (rule.activation === 'preview') {
      this.record(plan, 'preview');
      return { status: 'preview', ruleId: plan.ruleId, writes: plan.writes.length };
    }
    try {
      for (const write of plan.writes) this.internalPaths.add(write.path);
      const result = await this.adapter.apply(plan);
      this.failures.delete(plan.ruleId);
      this.record({ ...plan, ...result }, 'applied');
      return { status: 'applied', ruleId: plan.ruleId, writes: plan.writes.length };
    } catch (error) {
      const signature = `${error.code ?? 'ERROR'}:${error.message}`;
      const previous = this.failures.get(plan.ruleId);
      const count = previous?.signature === signature ? previous.count + 1 : 1;
      this.failures.set(plan.ruleId, { signature, count });
      if (count >= 3) this.pausedRules.add(plan.ruleId);
      this.record(plan, count >= 3 ? 'failed' : 'conflict', error.code ?? 'ERROR');
      throw error;
    } finally {
      for (const write of plan.writes) this.internalPaths.delete(write.path);
    }
  }

  record(plan, status, code = null) {
    if (!this.settings.journal.enabled) return;
    const entry = createJournalEntry({
      ruleId: plan.ruleId,
      paths: plan.writes.map((write) => write.path),
      properties: plan.writes.map((write) => write.property),
      preHashes: plan.preHashes,
      postHashes: plan.postHashes,
      status,
      code,
      timestamp: this.now()
    });
    this.journal = appendBoundedJournal(this.journal, entry, this.settings.journal.maxEntries);
  }
}
