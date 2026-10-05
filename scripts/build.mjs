import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adapter = readFileSync(join(root, 'src', 'frontmatter-adapter.mjs'), 'utf8')
  .replace('export const replaceQuotedWikiLinkList', 'const replaceQuotedWikiLinkList');
const source = readFileSync(join(root, 'src', 'main.cjs'), 'utf8');
const marker = "const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');";
const output = source.replace(marker, (match) => `${match}\n\n${adapter.trim()}`);
writeFileSync(join(root, 'main.js'), output.replace(/\n*$/, '\n'));
console.log(JSON.stringify({ status: 'built', output: 'main.js' }));
