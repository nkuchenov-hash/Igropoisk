import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const defaultModel = process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen3-1.7B-ONNX';
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

const boilerplatePattern = /cookie|newsletter|subscribe|sign up|privacy policy|when you (?:purchase|buy) through links|we may (?:earn|receive) (?:an )?(?:affiliate )?commission|affiliate commission|here(?:'s| is) how (?:it|this) works|support us|terms (?:of|and) conditions|all rights reserved/i;

function paragraphText(html = '') {
  return (String(html).match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(cleanText)
    .filter(text => text.length >= 40 && !boilerplatePattern.test(text));
}

export function extractArticleText(html = '') {
  const article = String(html).match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || '';
  const main = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  const candidates = [paragraphText(article), paragraphText(main), paragraphText(html)];
  const paragraphs = candidates.find(items => items.length >= 3) || candidates.find(items => items.length) || [];
  return [...new Set(paragraphs)].join('\n\n').slice(0, 5000).trim();
}

export async function fetchArticleText(url, timeoutMs = 18000) {
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
    return extractArticleText(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

function protectedNames(title = '') {
  const matches = String(title).match(/\b(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+)(?:\s+(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+|\d{2,4})){0,3}\b/g) || [];
  return [...new Set(matches.filter(value => value.length >= 2))].slice(0, 12);
}

function qwenPrompt({ title, summary, articleText, source, draftTitleRu, draftSummaryRu }) {
  const material = (articleText || summary || title || '').slice(0, 5000);
  const names = protectedNames(title);
  const system = `Ты русский редактор игрового издания «Игропоиск». Пиши как живой редактор, а не как машинный переводчик. Нельзя додумывать факты. Нельзя менять смысл. Названия игр, компаний, сервисов, мероприятий и имена собственные из оригинала сохраняй точно; если нет общеупотребительного русского варианта, оставляй латиницей. Игнорируй рекламные, партнерские, навигационные и подписочные фразы сайта.`;
  const user = `/no_think\nСделай короткую русскую новость по материалу ниже.\n\nИсточник: ${source || 'не указан'}\nОригинальный заголовок: ${title || ''}\nОригинальный лид: ${summary || ''}\n${draftTitleRu ? `Черновой машинный заголовок на русском: ${draftTitleRu}\n` : ''}${draftSummaryRu ? `Черновой машинный текст на русском: ${draftSummaryRu}\n` : ''}${names.length ? `Имена и названия, которые нельзя искажать: ${names.join(' | ')}\n` : ''}\nФактический материал:\n${material}\n\nТребования:\n1. Заголовок — естественный русский, 45–130 знаков. Не переводи названия игр и брендов буквально.\n2. Текст — 2–4 нормальных предложения, 320–700 знаков, можно разделить на два абзаца. Первое предложение сразу сообщает главное. Далее только важные детали и контекст.\n3. Не пиши «в статье говорится», «по данным материала», «как ИИ» и подобное.\n4. Не добавляй платформы, даты, должности, причины или последствия, которых нет в исходном материале.\n5. Не повторяй одно и то же предложение или факт.\n6. Не включай партнерские ссылки, комиссии магазина, подписки и служебный текст сайта.\n7. Черновой машинный перевод — только подсказка; исправь его полностью, если он звучит плохо.\n\nОтвет строго в таком виде, без JSON и без Markdown:\nЗАГОЛОВОК: <заголовок>\nТЕКСТ:\n<мини-новость>`;
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
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
  const titleMatch = cleaned.match(/(?:^|\n)ЗАГОЛОВОК:\s*(.+?)(?=\n|$)/i);
  const briefMatch = cleaned.match(/(?:^|\n)ТЕКСТ:\s*\n?([\s\S]+)$/i);
  if (!titleMatch || !briefMatch) throw new Error(`editor output missing markers: ${cleaned.slice(0, 260)}`);
  return { titleRu: titleMatch[1].trim(), briefRu: briefMatch[1].trim() };
}

function normalizedSentences(value = '') {
  return String(value)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.length >= 20);
}

export function validateEditedNews(value) {
  const titleRu = String(value?.titleRu || '').replace(/\s+/g, ' ').trim();
  const briefRu = String(value?.briefRu || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const reasons = [];
  if (!/[А-Яа-яЁё]/.test(titleRu)) reasons.push('title has no Cyrillic');
  if (!/[А-Яа-яЁё]/.test(briefRu)) reasons.push('brief has no Cyrillic');
  if (titleRu.length < 25 || titleRu.length > 180) reasons.push(`title length ${titleRu.length}`);
  if (briefRu.length < 260 || briefRu.length > 1000) reasons.push(`brief length ${briefRu.length}`);
  if ((briefRu.match(/[.!?](?:\s|$)/g) || []).length < 2) reasons.push('brief has fewer than 2 sentences');
  if (/\b(?:я как ии|искусственный интеллект|как модель|перевод статьи|в статье говорится|по данным материала)\b/i.test(briefRu)) reasons.push('meta language');
  if (boilerplatePattern.test(briefRu)) reasons.push('site boilerplate leaked into brief');
  const sentences = normalizedSentences(briefRu);
  if (sentences.length >= 2 && new Set(sentences).size !== sentences.length) reasons.push('duplicate sentence');
  return { ok: reasons.length === 0, reasons, titleRu, briefRu };
}

export async function editNewsToRussian(input, options = {}) {
  const generator = await getGenerator();
  const prompt = qwenPrompt(input);
  const startedAt = Date.now();
  const result = await generator(prompt, {
    max_new_tokens: Number(options.maxNewTokens || 300),
    do_sample: false,
    repetition_penalty: 1.12,
    return_full_text: false
  });
  const raw = generatedText(result);
  const parsed = parseEditorText(raw);
  const validation = validateEditedNews(parsed);
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
