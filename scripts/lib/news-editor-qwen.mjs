import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const defaultModel = process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen3-4B-Instruct-2507-ONNX';
const defaultDtype = process.env.NEWS_EDITOR_DTYPE || 'q4';
const cacheDir = process.env.NEWS_EDITOR_CACHE || '/tmp/igropoisk-news-editor-models';
const runtimeDir = process.env.NEWS_EDITOR_RUNTIME || '/tmp/igropoisk-news-editor-runtime';

let generatorPromise = null;

async function loadTransformersRuntime() {
  try {
    return await import('@huggingface/transformers');
  } catch {
    const requireFromRuntime = createRequire(`${runtimeDir}/package.json`);
    const modulePath = requireFromRuntime.resolve('@huggingface/transformers');
    return import(pathToFileURL(modulePath).href);
  }
}

async function getGenerator() {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { env, pipeline } = await loadTransformersRuntime();
      env.cacheDir = cacheDir;
      env.allowLocalModels = true;
      env.useFSCache = true;
      return pipeline('text-generation', defaultModel, { dtype: defaultDtype });
    })();
  }
  return generatorPromise;
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function cleanText(value = '') {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const boilerplatePattern = /cookie|newsletter|subscribe|sign up|privacy policy|when you (?:purchase|buy) through links|we may (?:earn|receive) (?:an )?(?:affiliate )?commission|affiliate commission|here(?:'s| is) how (?:it|this) works|support us|terms (?:of|and) conditions|all rights reserved|recommended by|shopping links|buying guide|follow us|more about|contact me with news/i;

function paragraphText(html = '') {
  return (String(html).match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(cleanText)
    .filter(text => text.length >= 45 && text.length <= 1400 && !boilerplatePattern.test(text));
}

function contextTerms(value = '') {
  const stop = new Set(['after', 'another', 'could', 'from', 'have', 'into', 'near', 'that', 'their', 'this', 'with', 'years', 'will', 'about', 'series', 'game', 'games']);
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9][a-z0-9'’-]{3,}/g) || [])]
    .filter(term => !stop.has(term))
    .slice(0, 32);
}

function rankParagraphs(paragraphs, context = '') {
  const terms = contextTerms(context);
  if (!terms.length) return paragraphs.slice(0, 8);
  const scored = paragraphs.map((text, index) => {
    const lower = text.toLowerCase();
    const overlap = terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
    const earlyBonus = index < 5 ? 1 : 0;
    return { text, index, score: overlap * 4 + earlyBonus };
  });
  const selected = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 7)
    .sort((a, b) => a.index - b.index)
    .map(item => item.text);
  return selected.length >= 2 ? selected : paragraphs.slice(0, 7);
}

export function extractArticleText(html = '', context = '') {
  const article = String(html).match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || '';
  const main = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  const candidates = [paragraphText(article), paragraphText(main), paragraphText(html)];
  const paragraphs = candidates.find(items => items.length >= 3) || candidates.find(items => items.length) || [];
  const unique = [...new Set(paragraphs)];
  return rankParagraphs(unique, context).join('\n\n').slice(0, 4300).trim();
}

export async function fetchArticleText(url, timeoutMs = 18000, context = '') {
  if (!/^https?:\/\//i.test(url || '')) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'IgropoiskNewsEditorExperiment/1.0 (+https://github.com/nkuchenov-hash/Igropoisk)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return extractArticleText(await response.text(), context);
  } finally {
    clearTimeout(timer);
  }
}

function protectedNames(title = '') {
  const matches = String(title).match(/\b(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+)(?:\s+(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+|\d{2,4})){0,3}\b/g) || [];
  const ignore = new Set(['Mass', 'Fans', 'Sudden', 'Another', 'Series', 'Future', 'Steam Page', 'Steam Deck']);
  return [...new Set(matches.filter(value => value.length >= 2 && !ignore.has(value)))].slice(0, 12);
}

function criticalNames(title = '') {
  return protectedNames(title).filter(value => {
    if (/^(?:FPS|CEO|RPG|PC)$/i.test(value)) return false;
    return /\d/.test(value) || /['’]/.test(value) || /\s/.test(value) || /^[A-Z]{2,}$/.test(value) || /^(?:Ubisoft|Steam|QuakeCon|Wolfenstein|PlayStation|Xbox|Nintendo|EA)$/i.test(value);
  });
}

function qwenPrompt({ title, summary, articleText, source, draftTitleRu, draftSummaryRu }) {
  const material = (articleText || summary || title || '').slice(0, 4300);
  const names = protectedNames(title);
  const system = `Ты редактор русского игрового издания «Игропоиск». Твоя задача — не переводить дословно, а написать короткую, точную и естественную новость на русском по предоставленным фактам. Ничего не выдумывай. Не меняй должности, цифры, даты и причинно-следственные связи. Названия игр, компаний, сервисов, мероприятий и имена собственные сохраняй точно; без общеупотребительного русского варианта оставляй латиницей. Игнорируй рекламу, партнерские вставки, подписки, навигацию и служебный текст сайта.`;
  const user = `Источник: ${source || 'не указан'}\nОригинальный заголовок: ${title || ''}\nОригинальный лид: ${summary || ''}\n${draftTitleRu ? `Черновой машинный заголовок: ${draftTitleRu}\n` : ''}${draftSummaryRu ? `Черновой машинный лид: ${draftSummaryRu}\n` : ''}${names.length ? `Названия и имена, которые нельзя искажать: ${names.join(' | ')}\n` : ''}\nОтобранные абзацы исходного материала:\n${material}\n\nНапиши результат строго так:\nЗАГОЛОВОК: <естественный русский заголовок 45–130 знаков>\nТЕКСТ:\n<2–3 предложения, примерно 180–500 знаков>\n\nПравила: первое предложение сообщает главное; второе дает важную конкретику или контекст. Не повторяй факты. Не вставляй рекламу, комиссии, призывы купить/подписаться и фразы вроде «в статье говорится». Не переводи названия игр и брендов буквально. Если факт есть только как предположение или слух, сохрани эту неопределенность.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function generatedText(result) {
  const first = Array.isArray(result) ? result[0] : result;
  const value = first?.generated_text ?? first?.text ?? '';
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return String(last?.content || last?.text || '').trim();
  }
  return String(value || '').trim();
}

function parseEditorText(text = '') {
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const titleMatch = cleaned.match(/(?:^|\n)ЗАГОЛОВ(?:О|А)К:\s*(.+?)(?=\n|$)/i);
  if (!titleMatch) throw new Error(`editor output missing headline: ${cleaned.slice(0, 260)}`);
  const explicitBrief = cleaned.match(/(?:^|\n)ТЕКСТ:\s*\n?([\s\S]+)$/i)?.[1]?.trim() || '';
  const titleLineEnd = cleaned.indexOf('\n', titleMatch.index + titleMatch[0].length);
  const fallbackBrief = titleLineEnd >= 0
    ? cleaned.slice(titleLineEnd + 1).replace(/^\s*(?:ТЕКСТ\s*:?\s*)?/i, '').trim()
    : '';
  const briefRu = explicitBrief || fallbackBrief;
  if (!briefRu) throw new Error(`editor output missing body: ${cleaned.slice(0, 320)}`);
  return { titleRu: titleMatch[1].trim(), briefRu };
}

function normalizedSentences(value = '') {
  return String(value)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.length >= 20);
}

export function validateEditedNews(value, input = {}) {
  const titleRu = String(value?.titleRu || '').replace(/\s+/g, ' ').trim();
  const briefRu = String(value?.briefRu || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const reasons = [];
  if (!/[А-Яа-яЁё]/.test(titleRu)) reasons.push('title has no Cyrillic');
  if (!/[А-Яа-яЁё]/.test(briefRu)) reasons.push('brief has no Cyrillic');
  if (titleRu.length < 25 || titleRu.length > 180) reasons.push(`title length ${titleRu.length}`);
  if (briefRu.length < 160 || briefRu.length > 700) reasons.push(`brief length ${briefRu.length}`);
  if ((briefRu.match(/[.!?](?:\s|$)/g) || []).length < 2) reasons.push('brief has fewer than 2 sentences');
  if (/\b(?:я как ии|искусственный интеллект|как модель|перевод статьи|в статье говорится|по данным материала)\b/i.test(briefRu)) reasons.push('meta language');
  if (boilerplatePattern.test(briefRu)) reasons.push('site boilerplate leaked into brief');
  const sentences = normalizedSentences(briefRu);
  if (sentences.length >= 2 && new Set(sentences).size !== sentences.length) reasons.push('duplicate sentence');
  const combined = `${titleRu} ${briefRu}`.toLowerCase();
  for (const name of criticalNames(input.title || '')) {
    if (!combined.includes(name.toLowerCase())) reasons.push(`critical name missing: ${name}`);
  }
  return { ok: reasons.length === 0, reasons, titleRu, briefRu };
}

export async function editNewsToRussian(input, options = {}) {
  const generator = await getGenerator();
  const prompt = qwenPrompt(input);
  const startedAt = Date.now();
  const result = await generator(prompt, {
    max_new_tokens: Number(options.maxNewTokens || 320),
    do_sample: false,
    repetition_penalty: 1.1
  });
  const raw = generatedText(result);
  const parsed = parseEditorText(raw);
  const validation = validateEditedNews(parsed, input);
  return {
    ...validation,
    raw,
    elapsedMs: Date.now() - startedAt,
    model: defaultModel,
    dtype: defaultDtype
  };
}

export async function warmNewsEditor() {
  const startedAt = Date.now();
  await getGenerator();
  return { model: defaultModel, dtype: defaultDtype, elapsedMs: Date.now() - startedAt };
}
