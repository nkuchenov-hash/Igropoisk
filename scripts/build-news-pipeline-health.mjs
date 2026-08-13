import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNewsImageReference } from './lib/news-image-reference.mjs';

const feedFiles = [
  'data/news.json',
  'data/publisher-news.json',
  'data/youtube-signals.json',
  'data/news-events.json',
  'data/news-home-ru.json'
];

function readJson(root, file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function items(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
}

function generatedAt(payload) {
  const value = payload?.generatedAt || payload?.generated_at || payload?.checkedAt || payload?.checked_at || '';
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function ageMinutes(value, now) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 60_000));
}

function statusCounts(report) {
  return report.reduce((result, source) => {
    const status = String(source?.status || 'unknown');
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
}

function sourceHistory(previous, report, checkedOfficial, checkedAt, persistentThreshold) {
  const previousById = new Map((previous?.sources?.history || []).map(source => [source.id, source]));
  return report.map(source => {
    const id = String(source?.id || 'unknown');
    const status = String(source?.status || 'unknown');
    const prior = previousById.get(id) || {};
    const successful = status === 'ok';
    const failed = status === 'error';
    let consecutiveFailures = Number(prior.consecutive_failures || 0);
    let lastSuccessAt = prior.last_success_at || null;
    let lastFailureAt = prior.last_failure_at || null;

    if (checkedOfficial) {
      if (successful) {
        consecutiveFailures = 0;
        lastSuccessAt = checkedAt;
      } else if (failed) {
        consecutiveFailures += 1;
        lastFailureAt = checkedAt;
      }
    }

    return {
      id,
      status,
      items: Number(source?.items || 0),
      error: failed ? String(source?.error || 'Unknown source error') : null,
      consecutive_failures: consecutiveFailures,
      persistent_failure: consecutiveFailures >= persistentThreshold,
      last_success_at: lastSuccessAt,
      last_failure_at: lastFailureAt
    };
  });
}

function collectImages(root, payloads, localRoots) {
  const referenced = new Set();
  for (const file of feedFiles) {
    if (file === 'data/youtube-signals.json') continue;
    for (const item of items(payloads.get(file))) {
      const image = String(item?.image || '').trim();
      if (image) referenced.add(image);
    }
  }
  const missing = [...referenced].filter(image => !validateNewsImageReference({ root, image, localRoots }).ok);
  return {
    referenced: referenced.size,
    missing: missing.length,
    missing_files: missing.slice(0, 50)
  };
}

export function buildNewsPipelineHealth({
  root = process.cwd(),
  configPath = 'config/news-pipeline.json',
  outputPath = null,
  dueGroups = [],
  now = Date.now(),
  runStartedAt = null
} = {}) {
  const config = readJson(root, configPath);
  if (!config) throw new Error(`News pipeline config is unavailable: ${configPath}`);
  const healthConfig = config.health || {};
  const target = outputPath || healthConfig.output_file || 'data/news-pipeline-health.json';
  const previous = readJson(root, target, {});
  const payloads = new Map(feedFiles.map(file => [file, readJson(root, file, {})]));
  const generatedAtIso = new Date(now).toISOString();
  const checkedOfficial = dueGroups.includes('official-sources');
  const persistentThreshold = Number(healthConfig.persistent_failure_threshold || 3);
  const warnings = [];
  const blocking = [];
  const data = {};

  for (const file of feedFiles) {
    const payload = payloads.get(file);
    const fileGeneratedAt = generatedAt(payload);
    const count = items(payload).length;
    const age = ageMinutes(fileGeneratedAt, now);
    const minimum = Number(config.publication?.minimum_items?.[file] || 0);
    const warningAge = Number(healthConfig.warning_age_minutes?.[file] || 0);
    const blockingAge = Number(healthConfig.blocking_age_minutes?.[file] || 0);
    data[file] = {
      generated_at: fileGeneratedAt,
      age_minutes: age,
      count,
      minimum
    };
    if (!fileGeneratedAt) blocking.push(`${file}: отсутствует корректное время генерации.`);
    if (count < minimum) blocking.push(`${file}: ${count} элементов при минимуме ${minimum}.`);
    if (age !== null && blockingAge && age > blockingAge) blocking.push(`${file}: данные старше ${blockingAge} минут.`);
    else if (age !== null && warningAge && age > warningAge) warnings.push(`${file}: данные старше ${warningAge} минут.`);
    if (minimum > 0 && count >= minimum && count <= Math.ceil(minimum * 1.25)) {
      warnings.push(`${file}: объём близок к минимальному порогу (${count}/${minimum}).`);
    }
  }

  const official = payloads.get('data/publisher-news.json') || {};
  const report = Array.isArray(official.sourceReport) ? official.sourceReport : [];
  const totalSources = Number(official.sourceCount || report.length || 0);
  const successfulSources = Number(official.successfulSourceCount || report.filter(source => source.status === 'ok').length || 0);
  const successRatio = totalSources ? successfulSources / totalSources : 0;
  const sourceCheckedAt = generatedAt(official) || generatedAtIso;
  const history = sourceHistory(previous, report, checkedOfficial, sourceCheckedAt, persistentThreshold);
  const currentFailures = history.filter(source => source.status === 'error');
  const persistentFailures = history.filter(source => source.persistent_failure);
  const minimumRatio = Number(config.publication?.minimum_official_source_success_ratio || 0);

  if (!totalSources) blocking.push('Реестр официальных источников пуст.');
  else if (successRatio < minimumRatio) blocking.push(`Работает только ${(successRatio * 100).toFixed(1)}% официальных источников.`);
  if (persistentFailures.length) warnings.push(`Систематически не работают источники: ${persistentFailures.map(source => source.id).join(', ')}.`);

  const images = collectImages(root, payloads, config.publication?.image_roots || []);
  if (images.missing) blocking.push(`Отсутствуют ${images.missing} изображений, на которые ссылаются новости.`);

  const status = blocking.length ? 'error' : warnings.length ? 'degraded' : 'healthy';
  const health = {
    schema_version: 1,
    pipeline: 'news',
    status,
    generated_at: generatedAtIso,
    last_successful_run_at: runStartedAt || generatedAtIso,
    due_groups: [...dueGroups],
    data,
    images,
    sources: {
      generated_at: sourceCheckedAt,
      total: totalSources,
      successful: successfulSources,
      success_ratio: Number(successRatio.toFixed(4)),
      status_counts: statusCounts(report),
      current_failures: currentFailures,
      persistent_failures: persistentFailures,
      history
    },
    thresholds: {
      minimum_official_source_success_ratio: minimumRatio,
      persistent_failure_runs: persistentThreshold,
      warning_age_minutes: healthConfig.warning_age_minutes || {},
      blocking_age_minutes: healthConfig.blocking_age_minutes || {}
    },
    warnings,
    blocking_errors: blocking
  };

  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), `${JSON.stringify(health, null, 2)}\n`, 'utf8');
  return health;
}

function parseArguments(argv) {
  const result = { dueGroups: [], runStartedAt: null, outputPath: null, configPath: 'config/news-pipeline.json' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--groups') result.dueGroups = String(argv[++index] || '').split(',').filter(Boolean);
    else if (value === '--run-started-at') result.runStartedAt = argv[++index] || null;
    else if (value === '--output') result.outputPath = argv[++index] || null;
    else if (value === '--config') result.configPath = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const health = buildNewsPipelineHealth(parseArguments(process.argv.slice(2)));
  console.log(`News pipeline health: ${health.status}; ${health.sources.successful}/${health.sources.total} official sources.`);
}
