#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'data/top-250/provider-probe.json');
const result = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  github_models: { ok: false },
  web_search: { ok: false }
};

async function probeModels() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    result.github_models.error = 'GITHUB_TOKEN_missing';
    return;
  }
  try {
    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4.1-mini',
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        max_tokens: 8,
        temperature: 0
      })
    });
    result.github_models.http_status = response.status;
    const text = await response.text();
    result.github_models.ok = response.ok && /OK/i.test(text);
    if (!response.ok) result.github_models.error = text.slice(0, 1200);
  } catch (error) {
    result.github_models.error = String(error?.message || error);
  }
}

async function probeSearch() {
  try {
    const url = 'https://www.bing.com/search?q=Baldur%27s+Gate+3+review&format=rss';
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 IgropoiskResearchBot/1.0' } });
    result.web_search.http_status = response.status;
    const text = await response.text();
    const items = [...text.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)];
    result.web_search.result_count = items.length;
    result.web_search.ok = response.ok && items.length >= 3;
    if (!result.web_search.ok) result.web_search.error = text.slice(0, 1200);
  } catch (error) {
    result.web_search.error = String(error?.message || error);
  }
}

await Promise.all([probeModels(), probeSearch()]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.github_models.ok || !result.web_search.ok) process.exitCode = 2;
