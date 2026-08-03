import fs from 'node:fs';

const file = 'data/popular/current.json';
const runFile = 'data/parser-runs/popular.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const blockedTitles = [
  /^steam deck$/i,
  /^steam machine$/i,
  /^valve index/i,
  /^steam controller$/i,
  /soundtrack$/i,
  /dedicated server$/i,
  /benchmark$/i,
  /sdk$/i
];

const isGame = item => {
  const title = String(item.title || '').trim();
  if (!title) return false;
  return !blockedTitles.some(pattern => pattern.test(title));
};

const seen = new Set();
data.ranking = (data.ranking || []).filter(item => {
  if (!isGame(item)) return false;
  const key = String(item.slug || item.title).toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  if (!item.image) {
    const steam = (item.evidence || []).find(row => Number(row.appid));
    if (steam) item.image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steam.appid}/library_600x900.jpg`;
  }
  return true;
}).slice(0, 30);

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
try {
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  run.ranked_count = data.ranking.length;
  run.note = `Опубликовано ${data.ranking.length} игровых позиций после удаления оборудования и служебных продуктов.`;
  fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
} catch {}
