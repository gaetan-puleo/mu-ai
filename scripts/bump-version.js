import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: bump-version.js <version>');
  process.exit(1);
}

const targets = [
  'packages/core/package.json',
  'packages/tui/package.json',
  'packages/local-provider/package.json',
  'packages/tools/package.json',
  'packages/coding-agent/package.json',
  'packages/webfetch/package.json',
];

for (const path of targets) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`bumped ${json.name} -> ${version}`);
}
