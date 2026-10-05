const keyPattern = (property) => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:"${escaped}"|${escaped}):(?:[ \\t]*(.*))?$`);
};

const wikiLink = (value) => {
  const text = String(value).trim();
  if (!/^\[\[[^\n\r\]"]+\]\]$/.test(text)) throw new Error('unsupported wiki link value');
  return text;
};

export const replaceQuotedWikiLinkList = (content, property, values) => {
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
