import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const defaultModel = process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen2.5-1.5B-Instruct';
const defaultDtype = process.env.NEWS_EDITOR_DTYPE || 'q4f16';
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

function paragraphText(html = '') {
  return (String(html).match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(cleanText)
    .filter(text => text.length >= 40 && !/cookie|newsletter|subscribe|sign up|privacy policy/i.test(text));
}

export function extractArticleText(html = '') {
  const article = String(html).match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || '';
  const main = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  const candidates = [paragraphText(article), paragraphText(main), paragraphText(html)];
  const paragraphs = candidates.find(items => items.length >= 3) || candidates.find(items => items.length) || [];
  return [...new Set(paragraphs)].join('\n\n').slice(0, 8000).trim();
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

function qwenPrompt({ title, summary, articleText, source }) {
  const material = (articleText || summary || title || '').slice(0, 8000);
  const system = `Ты редактор русскоязычного игрового издания «Игропоиск». Твоя задача — не переводить дословно, а написать естественную короткую новость по фактам исходного материала. Ничего не выдумывай. Сохраняй официальные названия игр, компаний, персонажей, устройств, числа и даты. Пиши современным живым русским языком, без канцелярита и машинных оборотов.`;
  const user = `Источник: ${source || 'не указан'}\nИсходный заголовок: ${title || ''}\nКраткое описание: ${summary || ''}\n\nМатериал:\n${material}\n\nВерни ТОЛЬКО валидный JSON без Markdown в формате {"titleRu":"...","briefRu":"..."}.\ntitleRu: естественный русский новостной заголовок, примерно 45–120 знаков.\nbriefRu: самостоятельная мини-новость из 1–2 абзацев, примерно 450–900 знаков. Сначала сообщи главное событие, затем важные детали и контекст. Не упоминай, что ты переводишь или пересказываешь статью.`;
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

function parseEditorJson(text = '') {
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error(`editor output is not JSON: ${cleaned.slice(0, 240)}`);
}

export function validateEditedNews(value) {
  const titleRu = String(value?.titleRu || '').replace(/\s+/g, ' ').trim();
  const briefRu = String(value?.briefRu || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const reasons = [];
  if (!/[А-Яа-яЁё]/.test(titleRu)) reasons.push('title has no Cyrillic');
  if (!/[А-Яа-яЁё]/.test(briefRu)) reasons.push('brief has no Cyrillic');
  if (titleRu.length < 25 || titleRu.length > 180) reasons.push(`title length ${titleRu.length}`);
  if (briefRu.length < 280 || briefRu.length > 1400) reasons.push(`brief length ${briefRu.length}`);
  if ((briefRu.match(/[.!?](?:\s|$)/g) || []).length < 2) reasons.push('brief has fewer than 2 sentences');
  if (/\b(?:я как ии|искусственный интеллект|как модель|перевод статьи)\b/i.test(briefRu)) reasons.push('meta language');
  return { ok: reasons.length === 0, reasons, titleRu, briefRu };
}

export async function editNewsToRussian(input, options = {}) {
  const generator = await getGenerator();
  const prompt = qwenPrompt(input);
  const startedAt = Date.now();
  const result = await generator(prompt, {
    max_new_tokens: Number(options.maxNewTokens || 360),
    do_sample: false,
    repetition_penalty: 1.08,
    return_full_text: false
  });
  const raw = generatedText(result);
  const parsed = parseEditorJson(raw);
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
