#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const token = process.env.GITHUB_TOKEN;
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const target = Math.max(1, Math.min(20, Number(targetArg?.split('=')[1] || 10)));
const limit = Math.max(target, Math.min(20, Number(limitArg?.split('=')[1] || 20)));
const model = process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini';
const currentYear = new Date().getUTCFullYear();
const now = Date.now();
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const exists = relative => fs.existsSync(path.join(root, relative));
const write = (relative, content) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const writeJson = (relative, value) => write(relative, `${JSON.stringify(value, null, 2)}\n`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const words = value => (String(value || '').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g) || []).length;
const xmlDecode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
const stripHtml = value => xmlDecode(String(value || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());

const editorialDomains = [
  'ign.com','gamespot.com','pcgamer.com','eurogamer.net','polygon.com','gamesradar.com','rockpapershotgun.com','vg247.com',
  'theverge.com','arstechnica.com','destructoid.com','shacknews.com','digitaltrends.com','techradar.com','pushsquare.com',
  'nintendolife.com','gameinformer.com','hardcoregamer.com','cgmagonline.com','gamingtrend.com','gamingbolt.com','windowscentral.com',
  'inverse.com','slantmagazine.com','theguardian.com','washingtonpost.com','kotaku.com','escapistmagazine.com','rpgsite.net','rpgfan.com',
  'mmorpg.com','checkpointgaming.net','well-played.com.au','wccftech.com','venturebeat.com','engadget.com','axios.com','forbes.com'
];
const blockedDomains = ['youtube.com','youtu.be','reddit.com','wikipedia.org','metacritic.com','opencritic.com','steamcommunity.com','store.steampowered.com','fandom.com'];
const professional = hostname => editorialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
const blocked = hostname => blockedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 12000);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IgropoiskResearchBot/1.0; +https://github.com/nkuchenov-hash/Igropoisk)', Accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    const get = tag => xmlDecode((block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [,''])[1]).trim();
    return { title: stripHtml(get('title')), url: get('link'), description: stripHtml(get('description')) };
  }).filter(item => item.url);
}

async function discoverSources(title) {
  const queries = [
    `\"${title}\" review`,
    `\"${title}\" review gameplay criticism`,
    `\"${title}\" review IGN GameSpot PC Gamer Eurogamer`,
    `\"${title}\" retrospective review`
  ];
  const found = new Map();
  for (const query of queries) {
    try {
      const xml = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`, { accept: 'application/rss+xml,application/xml,text/xml,*/*' });
      for (const item of parseRss(xml)) {
        let parsed;
        try { parsed = new URL(item.url); } catch { continue; }
        const hostname = parsed.hostname.replace(/^www\./,'').toLowerCase();
        if (blocked(hostname) || !professional(hostname)) continue;
        parsed.hash = '';
        ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(key => parsed.searchParams.delete(key));
        const key = `${parsed.origin}${parsed.pathname}${parsed.search}`;
        if (!found.has(key)) found.set(key, { ...item, url: key, domain: hostname });
      }
    } catch (error) {
      console.error(`Search failed for ${title}: ${error.message}`);
    }
  }
  const candidates = [...found.values()].slice(0, 14);
  const enriched = [];
  for (const item of candidates) {
    let excerpt = item.description || '';
    try {
      const html = await fetchText(item.url, { timeout: 9000 });
      const meta = (html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i) || [,''])[1];
      const body = stripHtml(html);
      excerpt = [stripHtml(meta), item.description, body.slice(0, 1800)].filter(Boolean).join(' — ').slice(0, 2200);
    } catch {}
    if (excerpt.length < 80) continue;
    enriched.push({ id: `source-${enriched.length + 1}`, name: item.title || item.domain, url: item.url, domain: item.domain, excerpt });
    if (enriched.length >= 10) break;
  }
  return enriched;
}

async function callModel(item, sources, retryNote = '') {
  if (!token) throw new Error('GITHUB_TOKEN_missing');
  const sourceText = sources.map(source => `${source.id} | ${source.name} | ${source.domain}\n${source.excerpt}`).join('\n\n');
  const prompt = `Ты пишешь пилотный профессиональный обзор для Игропоиска на русском языке. Игра: ${item.title}${item.year ? ` (${item.year})` : ''}.
Используй ТОЛЬКО факты и оценки, которые можно обосновать данными источниками. Не придумывай продажи, текущий онлайн, даты патчей или состояние серверов. Различай факт и редакционное суждение. Если источники расходятся — отрази расхождение. Не пересказывай один обзор: синтезируй общий критический вывод.

Требования: 6 смысловых разделов; в каждом ровно 2 содержательных абзаца; весь материал примерно 1200–1700 русских слов; конкретно разбирать игровой цикл, сильные стороны, слабые стороны, дизайн/контент, техническое или сервисное состояние там, где это подтверждено, и кому игра подходит. У каждого раздела укажи 2–5 source_ids. Оценка score от 1 до 10 с одним знаком после запятой. Никаких рекламных формулировок.
${retryNote ? `Предыдущая попытка не прошла локальную проверку: ${retryNote}. Исправь это.\n` : ''}
Верни ТОЛЬКО JSON-объект без markdown с полями: title, dek, lead, score, sections (массив объектов heading, paragraphs[2], source_ids[]), verdict (summary, best_for[], not_for[]), methodology.

ИСТОЧНИКИ:\n${sourceText}`;
  const response = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Ты редактор игрового издания. Пиши аналитично, конкретно и без выдуманных фактов.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_tokens: 3900, temperature: 0.35 })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`GitHub Models HTTP ${response.status}: ${raw.slice(0,500)}`);
  const envelope = JSON.parse(raw);
  const content = envelope?.choices?.[0]?.message?.content;
  if (!content) throw new Error('GitHub Models returned no content');
  return JSON.parse(content);
}

function validateGenerated(article, sources) {
  const errors = [];
  if (!article?.title || !article?.dek || !article?.lead) errors.push('missing title/dek/lead');
  if (!Number.isFinite(Number(article?.score)) || Number(article.score) < 1 || Number(article.score) > 10) errors.push('invalid score');
  if (!Array.isArray(article?.sections) || article.sections.length !== 6) errors.push(`sections ${article?.sections?.length || 0}/6`);
  const sourceIds = new Set(sources.map(source => source.id));
  for (const [index, section] of (article?.sections || []).entries()) {
    if (!section?.heading) errors.push(`section ${index + 1} missing heading`);
    if (!Array.isArray(section?.paragraphs) || section.paragraphs.length !== 2) errors.push(`section ${index + 1} paragraphs`);
    if (words((section?.paragraphs || []).join(' ')) < 120) errors.push(`section ${index + 1} too short`);
    if (!Array.isArray(section?.source_ids) || section.source_ids.length < 2 || section.source_ids.some(id => !sourceIds.has(id))) errors.push(`section ${index + 1} bad sources`);
  }
  const totalWords = words([article?.lead, ...(article?.sections || []).flatMap(section => section.paragraphs || []), article?.verdict?.summary].join(' '));
  if (totalWords < 900) errors.push(`article too short ${totalWords}`);
  if (!article?.verdict?.summary) errors.push('missing verdict');
  return { errors, totalWords };
}

function render(item, article, sources, totalWords) {
  const hero = item.image || '';
  const gamePage = exists(`game/${item.slug}/index.html`) ? `/Igropoisk/game/${encodeURIComponent(item.slug)}/` : null;
  const sectionHtml = article.sections.map((section, index) => `<section class="pilot-section" id="section-${index+1}"><div class="pilot-section__num">${String(index+1).padStart(2,'0')}</div><h2>${esc(section.heading)}</h2>${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}<div class="pilot-section__refs">${section.source_ids.map(id => `<a href="#${esc(id)}">${esc(id)}</a>`).join(' ')}</div></section>`).join('');
  const sourceHtml = sources.map((source,index) => `<a class="pilot-source" id="${esc(source.id)}" href="${esc(source.url)}" target="_blank" rel="noopener"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b><small>${esc(source.domain)}</small></div><strong>↗</strong></a>`).join('');
  const best = (article.verdict?.best_for || []).map(x=>`<li>${esc(x)}</li>`).join('');
  const notFor = (article.verdict?.not_for || []).map(x=>`<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(article.dek)}"><title>${esc(article.title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/pilot-review.css"></head><body><header class="pilot-nav"><a href="/Igropoisk/">ИГРОПОИСК</a><nav><a href="/Igropoisk/top-250/">Топ-250</a>${gamePage?`<a href="${gamePage}">К игре</a>`:''}</nav></header><section class="pilot-hero"${hero?` style="--hero:url(&quot;${esc(hero)}&quot;)"`:''}><div class="pilot-hero__inner"><div class="pilot-kicker">Обзор Игропоиска · пилот Top-250</div><h1>${esc(article.title)}</h1><p>${esc(article.dek)}</p><div class="pilot-meta"><strong>${Number(article.score).toFixed(1)} / 10</strong><span>${sources.length} профессиональных источников</span><span>${totalWords} слов</span></div></div></section><main class="pilot-layout"><article><p class="pilot-lead">${esc(article.lead)}</p>${sectionHtml}<section class="pilot-verdict"><div class="pilot-kicker">Вердикт</div><h2>${Number(article.score).toFixed(1)} / 10</h2><p>${esc(article.verdict.summary)}</p><div class="pilot-verdict__grid"><div><h3>Подойдёт</h3><ul>${best}</ul></div><div><h3>Не подойдёт</h3><ul>${notFor}</ul></div></div></section><section class="pilot-method"><div class="pilot-kicker">Методика</div><p>${esc(article.methodology || 'Материал синтезирован по профессиональным рецензиям и проверен на привязку утверждений к источникам.')}</p></section><section class="pilot-sources"><div class="pilot-kicker">Источники</div><h2>Профессиональные материалы</h2>${sourceHtml}</section></article></main></body></html>`;
}

if (!token) { console.error('GITHUB_TOKEN_missing'); process.exit(2); }
if (!exists('data/top-250/current.json')) { console.error('Run build-top-250 first'); process.exit(2); }
const top = readJson('data/top-250/current.json');
const results = [];
let success = 0;

for (const item of (top.ranking || []).slice(0, limit)) {
  const pilotPath = `data/pilot-reviews/${item.slug}.json`;
  const pagePath = `article/${item.slug}/index.html`;
  if (exists(pilotPath) && exists(pagePath)) {
    results.push({ rank: item.rank, slug: item.slug, status: 'existing' });
    success += 1;
    if (success >= target) break;
    continue;
  }
  if (Number(item.year || 0) >= currentYear || !Number(item.year || 0)) {
    results.push({ rank: item.rank, slug: item.slug, status: 'hold', reason: 'current_future_or_unknown_year' });
    continue;
  }
  if (success >= target) break;
  console.log(`\n=== ${item.rank}. ${item.title} (${item.year}) ===`);
  const sources = await discoverSources(item.title);
  if (sources.length < 6) {
    results.push({ rank: item.rank, slug: item.slug, status: 'blocked', reason: `professional_sources_${sources.length}/6` });
    continue;
  }
  let generated;
  let check;
  try {
    generated = await callModel(item, sources);
    check = validateGenerated(generated, sources);
    if (check.errors.length) {
      generated = await callModel(item, sources, check.errors.join('; '));
      check = validateGenerated(generated, sources);
    }
    if (check.errors.length) throw new Error(check.errors.join('; '));
  } catch (error) {
    console.error(`${item.slug}: ${error.message}`);
    results.push({ rank: item.rank, slug: item.slug, status: 'blocked', reason: error.message.slice(0,300) });
    continue;
  }
  const storedSources = sources.map(({ id, name, url, domain }) => ({ id, name, url, domain, purpose: 'professional_review' }));
  const stored = {
    schema_version: 'pilot-1', slug: item.slug, game_slug: item.slug, game_id: item.game_id, game_title: item.title, release_year: item.year,
    title: generated.title, dek: generated.dek, lead: generated.lead, score: Number(Number(generated.score).toFixed(1)), hero: item.image || '',
    author: 'Редакция Игропоиска', publication_status: 'published', published_at: new Date().toISOString(), reading_time_minutes: Math.max(5, Math.round(check.totalWords / 180)),
    source_gate: { required_editorial: 6, accepted_editorial: storedSources.length, passed: true }, source_coverage: { available: storedSources.length, materially_used: new Set(generated.sections.flatMap(section=>section.source_ids)).size },
    methodology: generated.methodology, sections: generated.sections.map((section,index)=>({ id: `section-${index+1}`, heading: section.heading, paragraphs: section.paragraphs, source_ids: section.source_ids })),
    verdict: generated.verdict, sources: storedSources, generation: { provider: 'github-models', model, web_search: 'bing-rss', generated_at: new Date().toISOString() }
  };
  writeJson(pilotPath, stored);
  write(pagePath, render(item, stored, storedSources, check.totalWords));
  results.push({ rank: item.rank, slug: item.slug, status: 'published', sources: storedSources.length, words: check.totalWords, score: stored.score });
  success += 1;
}

const status = { schema_version: 1, generated_at: new Date().toISOString(), provider: 'github-models+bing-rss', target, limit, published: success, passed: success >= target, results };
writeJson('data/top-250/keyless-review-pilot-status.json', status);
console.log(JSON.stringify(status, null, 2));
if (!status.passed) process.exit(2);
