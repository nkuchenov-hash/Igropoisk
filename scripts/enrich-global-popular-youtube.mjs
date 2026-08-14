import fs from 'node:fs';
import path from 'node:path';
import {
  createPopularEntityResolver,
  recomputePopularityIndices
} from './lib/popular-entity-resolution.mjs';

const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
const key = process.env.YOUTUBE_API_KEY;
const popularPath = 'data/popular/current.json';
const runPath = 'data/parser-runs/popular.json';
const config = read('config/parsers/popular.json');
const data = read(popularPath);
const run = read(runPath);
const checkedAt = new Date().toISOString();

if (!key) {
  run.source_statuses = [...(run.source_statuses || []), {
    id: 'youtube-global-search',
    status: 'skipped',
    error: 'YOUTUBE_API_KEY is not configured'
  }];
  write(runPath, run);
  console.log('YouTube global search skipped: no API key.');
  process.exit(0);
}

const timeout = 25_000;
const fetchJSON = async url => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': 'IgropoiskPopularityEnricher/2.0' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const resolverCandidates = new Map();
for (const entry of [...(config.global_candidates || []), ...(config.aliases || [])]) {
  if (!entry?.slug) continue;
  const existing = resolverCandidates.get(entry.slug) || { ...entry, aliases: [] };
  existing.title ||= entry.title;
  existing.aliases = [...new Set([...(existing.aliases || []), ...(entry.aliases || []), entry.title].filter(Boolean))];
  resolverCandidates.set(entry.slug, existing);
}
const entityResolver = createPopularEntityResolver([...resolverCandidates.values()], config);
const isCandidateSubject = (candidate, text) => entityResolver.resolve(text, { mode: 'editorial' })?.slug === candidate.slug;

const bySlug = new Map((data.ranking || []).map(item => [item.slug, item]));
const statuses = [];
const after = new Date(Date.now() - 72 * 3_600_000).toISOString();

for (const candidate of config.global_candidates || []) {
  const started = Date.now();
  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '20',
      order: 'viewCount',
      maxResults: '10',
      publishedAfter: after,
      q: candidate.title,
      key
    }).toString();
    const search = await fetchJSON(searchUrl);
    const searchItems = (search.items || []).filter(item =>
      item?.id?.videoId && isCandidateSubject(candidate, item.snippet?.title || '')
    );
    const ids = [...new Set(searchItems.map(item => item.id.videoId))];
    if (!ids.length) {
      statuses.push({ id: candidate.slug, status: 'success', matched: 0, duration_ms: Date.now() - started });
      continue;
    }

    const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailsUrl.search = new URLSearchParams({
      part: 'snippet,statistics',
      id: ids.join(','),
      key
    }).toString();
    const details = await fetchJSON(detailsUrl);
    const videos = (details.items || []).filter(video => isCandidateSubject(candidate, video.snippet?.title || ''));
    const evidence = videos.map(video => {
      const views = Number(video.statistics?.viewCount || 0);
      const comments = Number(video.statistics?.commentCount || 0);
      return {
        source: 'YouTube Search',
        title: video.snippet?.title || candidate.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        observed_at: video.snippet?.publishedAt || checkedAt,
        family: 'youtube',
        channel_id: video.snippet?.channelId || null,
        channel: video.snippet?.channelTitle || null,
        views,
        comments,
        value: Number((Math.log1p(views) + 0.5 * Math.log1p(comments)).toFixed(3))
      };
    });
    const channels = new Set(evidence.map(item => item.channel_id || item.channel).filter(Boolean));
    const totalViews = evidence.reduce((sum, item) => sum + item.views, 0);
    const totalComments = evidence.reduce((sum, item) => sum + item.comments, 0);
    if (!evidence.length) {
      statuses.push({ id: candidate.slug, status: 'success', matched: 0, duration_ms: Date.now() - started });
      continue;
    }

    const existing = bySlug.get(candidate.slug) || {
      slug: candidate.slug,
      title: candidate.title,
      year: candidate.year || null,
      image: candidate.image || '',
      image_candidates: candidate.image ? [candidate.image] : [],
      score: 0,
      confidence: 0,
      delta: null,
      families: [],
      signals: { news: 0, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 },
      news_sources: 0,
      news_publishers: [],
      in_catalog: false,
      global_candidate: true,
      evidence: []
    };
    const oldUrls = new Set((existing.evidence || []).map(item => item.url).filter(Boolean));
    const freshEvidence = evidence.filter(item => !oldUrls.has(item.url));
    existing.evidence = [...(existing.evidence || []), ...freshEvidence]
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      .slice(0, 30);
    existing.signals ||= { news: 0, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 };
    // Keep a single YouTube family signal. Do not replace the public score with a second capped formula.
    existing.signals.youtube = Math.max(
      Number(existing.signals.youtube || 0),
      evidence.reduce((sum, item) => sum + Number(item.value || 0), 0)
    );
    existing.youtube_community = {
      window_hours: 72,
      unique_videos: evidence.length,
      unique_channels: channels.size,
      total_views: totalViews,
      total_comments: totalComments,
      checked_at: checkedAt
    };
    const communityConfidence = Math.min(0.92, 0.38 + 0.04 * evidence.length + 0.05 * channels.size);
    existing.confidence = Number(Math.max(Number(existing.confidence || 0), communityConfidence).toFixed(2));
    existing.global_candidate = true;
    bySlug.set(candidate.slug, existing);
    statuses.push({
      id: candidate.slug,
      status: 'success',
      matched: evidence.length,
      channels: channels.size,
      views: totalViews,
      duration_ms: Date.now() - started
    });
  } catch (error) {
    statuses.push({ id: candidate.slug, status: 'error', error: error.message, duration_ms: Date.now() - started });
  }
}

data.ranking = recomputePopularityIndices([...bySlug.values()])
  .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.confidence || 0) - Number(a.confidence || 0))
  .slice(0, 80);
data.method ||= {};
data.method.global_youtube_search = 'Recent subject-matched gaming videos from distinct channels over 72 hours; folded into the same normalized YouTube family used by the main index';
data.source_statuses = [...(data.source_statuses || []), {
  id: 'youtube-global-search',
  status: statuses.some(item => item.status === 'success') ? 'success' : 'error',
  candidates: statuses
}];
write(popularPath, data);
run.ranked_count = data.ranking.length;
run.source_statuses = [...(run.source_statuses || []), {
  id: 'youtube-global-search',
  status: statuses.some(item => item.status === 'success') ? 'success' : 'error',
  candidates: statuses
}];
write(runPath, run);
console.log(JSON.stringify({
  candidates: statuses.length,
  matched_candidates: statuses.filter(item => Number(item.matched || 0) > 0).length,
  errors: statuses.filter(item => item.status === 'error').length
}, null, 2));
