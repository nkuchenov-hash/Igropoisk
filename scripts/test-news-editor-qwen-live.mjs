import fs from 'node:fs/promises';
import path from 'node:path';
import { editNewsToRussian, fetchArticleText, warmNewsEditor } from './lib/news-editor-qwen.mjs';

const inputPath = path.resolve('data/news.json');
const outputPath = path.resolve('tmp/news-qwen-editor-benchmark.json');
const limit = Math.max(1, Number(process.env.NEWS_EDITOR_BENCHMARK_LIMIT || 3));

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const candidates = (payload.items || [])
  .filter(item => item && (item.titleEn || item.title) && (item.summaryEn || item.summary || item.title))
  .filter(item => !/^[\s\S]*[А-Яа-яЁё][\s\S]*$/.test(item.titleEn || item.title || '') || item.language === 'en')
  .slice(0, Math.max(limit * 4, limit));

if (!candidates.length) throw new Error('No English news candidates available for Qwen benchmark.');

console.log(`[news/editor/qwen] warming ${process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen2.5-1.5B-Instruct'}...`);
const warmup = await warmNewsEditor();
console.log(`[news/editor/qwen] model ready in ${(warmup.elapsedMs / 1000).toFixed(1)}s`);

const results = [];
for (const item of candidates) {
  if (results.length >= limit) break;
  const title = String(item.titleEn || item.title || '').trim();
  const summary = String(item.summaryEn || item.summary || title).trim();
  let articleText = '';
  let articleFetchError = '';
  try {
    articleText = await fetchArticleText(item.primaryUrl || item.url || '');
  } catch (error) {
    articleFetchError = error.message;
  }

  console.log(`\n[news/editor/qwen] ${results.length + 1}/${limit}: ${title}`);
  console.log(`[news/editor/qwen] article characters: ${articleText.length}${articleFetchError ? `; fallback because ${articleFetchError}` : ''}`);

  try {
    const edited = await editNewsToRussian({
      title,
      summary,
      articleText,
      source: item.primarySource || item.source || item.publisher || ''
    });
    const record = {
      id: item.id,
      url: item.primaryUrl || item.url || '',
      source: item.primarySource || item.source || '',
      titleEn: title,
      summaryEn: summary,
      articleCharacters: articleText.length,
      articleFetchError,
      titleRu: edited.titleRu,
      briefRu: edited.briefRu,
      valid: edited.ok,
      validationReasons: edited.reasons,
      generationMs: edited.elapsedMs,
      raw: edited.raw
    };
    results.push(record);
    console.log(`[news/editor/qwen] generated in ${(edited.elapsedMs / 1000).toFixed(1)}s; valid=${edited.ok}`);
    console.log(`[news/editor/qwen] TITLE: ${edited.titleRu}`);
    console.log(`[news/editor/qwen] BRIEF: ${edited.briefRu}`);
  } catch (error) {
    results.push({
      id: item.id,
      url: item.primaryUrl || item.url || '',
      source: item.primarySource || item.source || '',
      titleEn: title,
      summaryEn: summary,
      articleCharacters: articleText.length,
      articleFetchError,
      valid: false,
      error: error.message
    });
    console.error(`[news/editor/qwen] failed: ${error.stack || error.message}`);
  }
}

const validCount = results.filter(item => item.valid).length;
const report = {
  generatedAt: new Date().toISOString(),
  model: warmup.model,
  dtype: warmup.dtype,
  modelLoadMs: warmup.elapsedMs,
  requestedCount: limit,
  processedCount: results.length,
  validCount,
  averageGenerationMs: results.filter(item => Number.isFinite(item.generationMs)).length
    ? Math.round(results.filter(item => Number.isFinite(item.generationMs)).reduce((sum, item) => sum + item.generationMs, 0) / results.filter(item => Number.isFinite(item.generationMs)).length)
    : null,
  results
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n[news/editor/qwen] wrote ${outputPath}; valid ${validCount}/${results.length}`);

if (results.length < limit) throw new Error(`Only ${results.length}/${limit} benchmark items were processed.`);
if (validCount < Math.max(1, Math.ceil(limit * 0.67))) {
  throw new Error(`Qwen editorial quality gate failed: ${validCount}/${results.length} valid outputs.`);
}
