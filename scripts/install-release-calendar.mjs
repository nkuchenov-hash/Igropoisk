import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const payloadDir = path.join(root, 'scripts', 'release-payload');
const encoded = fs.readdirSync(payloadDir)
  .filter(name => /^part-\d+\.txt$/.test(name))
  .sort()
  .map(name => fs.readFileSync(path.join(payloadDir, name), 'utf8').trim())
  .join('');
const files = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
let created = 0;
for (const [relative, content] of Object.entries(files)) {
  const target = path.join(root, relative);
  if (fs.existsSync(target)) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  created++;
}

const schedulePath = path.join(root, 'config', 'parsers', 'schedule.json');
const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
if (!(schedule.parsers || []).some(parser => parser.id === 'releases')) {
  schedule.parsers = [...(schedule.parsers || []), {
    id: 'releases',
    enabled: true,
    interval_minutes: 360,
    publication_policy: {
      create_page_drafts: true,
      auto_publish: false,
      preserve_editor_locked_fields: true,
      official_conflicts_require_review: true
    },
    command: 'node scripts/parse-releases.mjs',
    outputs: [
      'data/releases/current.json',
      'data/releases/changes.json',
      'data/parser-runs/releases.json',
      'data/release-drafts',
      'assets/covers/releases'
    ]
  }];
  fs.writeFileSync(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
}
console.log(`Release calendar installed: ${created} new files.`);
