const allowedStatus = new Set(['preview', 'applied', 'undone', 'conflict', 'failed', 'ignored']);

export const createJournalEntry = ({ ruleId, paths = [], properties = [], preHashes = {}, postHashes = {}, status, code = null, timestamp = new Date().toISOString() }) => {
  if (!allowedStatus.has(status)) throw new TypeError(`unsupported journal status: ${status}`);
  return {
    timestamp,
    ruleId: String(ruleId),
    status,
    code: code ? String(code) : null,
    paths: [...new Set(paths.map(String))].sort(),
    properties: [...new Set(properties.map(String))].sort(),
    preHashes: Object.fromEntries(Object.entries(preHashes).sort()),
    postHashes: Object.fromEntries(Object.entries(postHashes).sort())
  };
};

export const appendBoundedJournal = (entries, entry, maxEntries) => [...entries, entry].slice(-maxEntries);
