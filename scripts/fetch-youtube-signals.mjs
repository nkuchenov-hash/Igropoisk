import fs from 'node:fs/promises';

const registry = JSON.parse(await fs.readFile('data/youtube-sources.json', 'utf8'));
const outputPath = 'data/youtube-signals.json';
const userAgent = 'Mozilla/5.0 IgropoiskYouTubeBot/1.0';

function decode(value='') {
  return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

async function fetchText(url, timeout=15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { redirect:'follow', signal:controller.signal, headers:{'user-agent':userAgent} });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function channelIdFromHtml(html) {
  return html.match(/"channelId":"(UC[^"]+)"/)?.[1]
    || html.match(/<meta itemprop="channelId" content="([^"]+)"/)?.[1]
    || html.match(/youtube\.com\/channel\/(UC[\w-]+)/)?.[1]
    || '';
}

function tag(block, name) {
  return decode(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim();
}

const items = [];
const sourceStatus = [];
for (const source of registry.sources) {
  try {
    const html = await fetchText(source.url);
    const channelId = channelIdFromHtml(html);
    if (!channelId) throw new Error('channel id not found');
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const entry of entries.slice(0, 12)) {
      const title = tag(entry, 'title');
      const videoId = tag(entry, 'yt:videoId');
      const publishedAt = tag(entry, 'published');
      if (!title || !videoId || !publishedAt) continue;
      items.push({
        id: videoId,
        title,
        publishedAt,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: source.name,
        sourceKind: 'youtube',
        official: true
      });
    }
    sourceStatus.push({ name: source.name, ok: true, channelId, itemCount: entries.length });
  } catch (error) {
    sourceStatus.push({ name: source.name, ok: false, error: error.message });
  }
}

items.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt:new Date().toISOString(), items, sourceStatus }, null, 2)}\n`);
console.log(`[youtube] wrote ${items.length} official video signals from ${sourceStatus.filter(item => item.ok).length} channels`);
