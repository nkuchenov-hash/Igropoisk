import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const feedFiles = [
  'data/news.json',
  'data/publisher-news.json',
  'data/youtube-signals.json',
  'data/news-events.json',
  'data/news-home-ru.json'
];

const trackingParameters = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'ref', 'referrer', 'source'
]);

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function payloadItems(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
}

function payloadGeneratedAt(payload) {
  return payload?.generatedAt || payload?.generated_at || payload?.checkedAt || payload?.checked_at || null;
}

function itemUrl(item) {
  return String(item?.primaryUrl || item?.url || '').trim();
}

export function canonicalSourceUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return String(value || '').trim();
  }
}

function validDate(value) {
  return Number.isFinite(Date.parse(value || ''));
}

function validateFeed(root, file, payload, config, errors) {
  const items = payloadItems(payload);
  const minimum = Number(config.publication.minimum_items?.[file] || 0);
  if (items.length < minimum) errors.push(`${file} contains ${items.length} items; minimum is ${minimum}.`);

  const seenUrls = new Set();
  items.forEach((item, index) => {
    const prefix = `${file} item ${index + 1}`;
    const url = itemUrl(item);
    if (!/^https?:\/\//i.test(url)) errors.push(`${prefix} has no valid source URL.`);
    const canonicalUrl = canonicalSourceUrl(url);
    if (url && seenUrls.has(canonicalUrl)) errors.push(`${prefix} duplicates a source URL.`);
    if (url) seenUrls.add(canonicalUrl);
    if (!validDate(item.publishedAt)) errors.push(`${prefix} has no valid publishedAt.`);
    if (!String(item.titleRu || item.titleEn || item.title || '').trim()) errors.push(`${prefix} has no title.`);

    if (file !== 'data/youtube-signals.json') {
      const image = String(item.image || '').trim();
      if (!config.publication.image_roots.some(rootPrefix => image.startsWith(rootPrefix))) {
        errors.push(`${prefix} has an image outside approved roots: ${image || '(empty)'}.`);
      } else if (!/^[\w./-]+$/.test(image) || image.includes('..')) {
        errors.push(`${prefix} has an unsafe image path: ${image}.`);
      } else if (!fs.existsSync(path.join(root, image))) {
        errors.push(`${prefix} references a missing image: ${image}.`);
      }
    }
  });

  return items;
}

function baselinePayload(file, baseline) {
  if (!baseline) return null;
  try {
    const content = execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' });
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function validateHealth(health, payloads, itemCounts, config, errors) {
  const healthFile = config.health?.output_file || 'data/news-pipeline-health.json';
  if (!health || typeof health !== 'object') {
    errors.push(`${healthFile} is not an object.`);
    return;
  }
  if (health.pipeline !== 'news') errors.push(`${healthFile} has an invalid pipeline id.`);
  if (health.status === 'pending') {
    if (health.generated_at || health.last_successful_run_at) errors.push(`${healthFile} pending snapshot cannot claim a successful run.`);
    return;
  }
  if (!['healthy', 'degraded', 'error'].includes(health.status)) errors.push(`${healthFile} has an invalid status: ${health.status}.`);
  if (health.status === 'error') errors.push(`${healthFile} reports blocking health errors.`);
  if (!validDate(health.generated_at)) errors.push(`${healthFile} has no valid generated_at.`);
  if (!validDate(health.last_successful_run_at)) errors.push(`${healthFile} has no valid last_successful_run_at.`);
  if (!Array.isArray(health.due_groups) || !health.due_groups.length) errors.push(`${healthFile} has no checked source groups.`);

  for (const file of feedFiles) {
    const metric = health.data?.[file];
    const payload = payloads.get(file);
    if (!metric) {
      errors.push(`${healthFile} does not describe ${file}.`);
      continue;
    }
    if (Number(metric.count) !== Number(itemCounts[file] || 0)) errors.push(`${healthFile} count mismatch for ${file}.`);
    const sourceGeneratedAt = payloadGeneratedAt(payload);
    if (sourceGeneratedAt && metric.generated_at !== new Date(sourceGeneratedAt).toISOString()) {
      errors.push(`${healthFile} generated_at mismatch for ${file}.`);
    }
    const blockingAge = Number(config.health?.blocking_age_minutes?.[file] || 0);
    if (blockingAge && Number(metric.age_minutes) > blockingAge) errors.push(`${healthFile} marks ${file} older than ${blockingAge} minutes.`);
  }

  const official = payloads.get('data/publisher-news.json') || {};
  const totalSources = Number(official.sourceCount || official.sourceReport?.length || 0);
  const successfulSources = Number(official.successfulSourceCount || official.sourceReport?.filter(item => item.status === 'ok').length || 0);
  if (Number(health.sources?.total) !== totalSources) errors.push(`${healthFile} official source total is inconsistent.`);
  if (Number(health.sources?.successful) !== successfulSources) errors.push(`${healthFile} official source success count is inconsistent.`);
  if (!Array.isArray(health.sources?.history)) errors.push(`${healthFile} has no source history.`);
  if (!Array.isArray(health.sources?.persistent_failures)) errors.push(`${healthFile} has no persistent failure list.`);
  if (Number(health.images?.missing || 0) !== 0) errors.push(`${healthFile} reports missing images.`);
  if (!Array.isArray(health.warnings) || !Array.isArray(health.blocking_errors)) errors.push(`${healthFile} has invalid diagnostic lists.`);
  if (health.blocking_errors?.length) errors.push(`${healthFile} contains blocking errors.`);
}

export function validateNewsPipeline({ root = process.cwd(), configPath = 'config/news-pipeline.json', baseline = null } = {}) {
  const errors = [];
  const config = readJson(root, configPath);
  const payloads = new Map();

  for (const file of config.publication.required_files || []) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`Required pipeline output is missing: ${file}.`);
      continue;
    }
    try {
      payloads.set(file, readJson(root, file));
    } catch (error) {
      errors.push(`Invalid JSON in ${file}: ${error.message}`);
    }
  }

  const itemCounts = {};
  for (const file of feedFiles) {
    const payload = payloads.get(file);
    if (!payload) continue;
    const items = validateFeed(root, file, payload, config, errors);
    itemCounts[file] = items.length;
    const previous = baselinePayload(file, baseline);
    if (previous) {
      const previousCount = payloadItems(previous).length;
      const retained = previousCount ? items.length / previousCount : 1;
      const minimumRetained = Number(config.publication.minimum_retained_fraction || 0);
      if (retained < minimumRetained) {
        errors.push(`${file} retained only ${(retained * 100).toFixed(1)}% of the previous ${previousCount} items.`);
      }
    }
  }

  const homeFile = 'data/news-home-ru.json';
  const home = payloadItems(payloads.get(homeFile));
  const expectedHome = Number(config.publication.homepage_exact_items || 12);
  if (home.length !== expectedHome) errors.push(`${homeFile} must contain exactly ${expectedHome} items; found ${home.length}.`);
  for (const [index, item] of home.entries()) {
    if (!/[А-Яа-яЁё]/.test(String(item.titleRu || ''))) errors.push(`${homeFile} item ${index + 1} has no Russian title.`);
  }

  const official = payloads.get('data/publisher-news.json');
  if (official) {
    const totalSources = Number(official.sourceCount || official.sourceReport?.length || 0);
    const successfulSources = Number(official.successfulSourceCount || official.sourceReport?.filter(item => item.status === 'ok').length || 0);
    const ratio = totalSources ? successfulSources / totalSources : 0;
    const minimumRatio = Number(config.publication.minimum_official_source_success_ratio || 0);
    if (!totalSources) errors.push('Official source registry produced no source count.');
    else if (ratio < minimumRatio) errors.push(`Only ${(ratio * 100).toFixed(1)}% of official sources succeeded; minimum is ${(minimumRatio * 100).toFixed(1)}%.`);
  }

  validateHealth(payloads.get(config.health?.output_file || 'data/news-pipeline-health.json'), payloads, itemCounts, config, errors);

  const module = readJson(root, 'features/news/module.json');
  const contentFiles = new Set((module.content || []).filter(value => value.endsWith('.json')));
  for (const file of [...feedFiles, config.health?.output_file || 'data/news-pipeline-health.json']) {
    if (!contentFiles.has(file)) errors.push(`News pipeline source is absent from module.json: ${file}.`);
  }
  if (!module.contentApi || module.contentApi.global !== 'IgropoiskNewsContent') {
    errors.push('features/news/module.json does not declare IgropoiskNewsContent.');
  }
  if (module.pipeline?.health !== (config.health?.output_file || 'data/news-pipeline-health.json')) {
    errors.push('features/news/module.json does not declare the pipeline health snapshot.');
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: itemCounts,
    health: payloads.get(config.health?.output_file || 'data/news-pipeline-health.json')?.status || 'missing',
    checked_at: new Date().toISOString(),
    baseline
  };
}

function parseArguments(argv) {
  const result = { baseline: null, configPath: 'config/news-pipeline.json' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--baseline') result.baseline = argv[++index];
    else if (argv[index] === '--config') result.configPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateNewsPipeline(parseArguments(process.argv.slice(2)));
  if (!result.ok) {
    throw new Error(`News pipeline publication gate failed:\n${result.errors.map(error => `- ${error}`).join('\n')}`);
  }
  console.log(`News pipeline publication gate passed: ${JSON.stringify(result.counts)}; health=${result.health}.`);
}
