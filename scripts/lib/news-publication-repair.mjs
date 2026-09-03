const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';

function parseJsonObject(value = '') {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { return null; }
}

export async function repairNewsPublicationCopy(input = {}, {
  fetchImpl = globalThis.fetch,
  githubToken = process.env.GITHUB_TOKEN || '',
  model = process.env.NEWS_PUBLICATION_REPAIR_MODEL || 'openai/gpt-4.1',
  timeoutMs = 16000
} = {}) {
  if (!githubToken || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'GitHub Models repair unavailable: missing token or fetch' };
  }

  const requiredEntities = Array.isArray(input.requiredEntities)
    ? [...new Set(input.requiredEntities.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 16)
    : [];
  const source = {
    title: String(input.title || '').trim(),
    summary: String(input.summary || '').trim(),
    articleText: String(input.articleText || '').trim().slice(0, 5000),
    source: String(input.source || '').trim(),
    url: String(input.url || '').trim(),
    currentTitleRu: String(input.currentTitleRu || '').trim(),
    currentSummaryRu: String(input.currentSummaryRu || '').trim(),
    failureReasons: Array.isArray(input.failureReasons) ? input.failureReasons.slice(0, 12) : [],
    requiredEntities
  };

  const prompt = `Отредактируй новость для русского игрового издания «Игропоиск». Исправь только фактические, языковые и смысловые дефекты текущего русского текста. Используй только данные SOURCE, ничего не выдумывай. Сохрани цифры, даты, степень уверенности и причинно-следственные связи. Не переводи и не транслитерируй названия игр, компаний, сервисов и мероприятий из REQUIRED_ENTITIES; они должны присутствовать в точном написании, если перечислены. Удали кальку, обрывки, HTML-сущности, повторы и first-person автора источника. Заголовок: естественный русский, примерно 45–140 знаков. Текст: 2–3 законченных предложения, примерно 170–550 знаков. Верни ТОЛЬКО JSON {"titleRu":"...","summaryRu":"..."}. SOURCE=${JSON.stringify(source)}`;

  try {
    const response = await fetchImpl(GITHUB_MODELS_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${githubToken}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ты строгий редактор русскоязычных игровых новостей. Возвращай только валидный JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
        max_tokens: 320
      })
    });
    if (!response.ok) return { ok: false, reason: `GitHub Models repair HTTP ${response.status}` };
    const payload = await response.json();
    const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content || '');
    const titleRu = String(parsed?.titleRu || '').trim();
    const summaryRu = String(parsed?.summaryRu || '').trim();
    if (!titleRu || !summaryRu) return { ok: false, reason: 'GitHub Models repair returned incomplete JSON' };
    return { ok: true, titleRu, summaryRu, model };
  } catch (error) {
    return { ok: false, reason: `GitHub Models repair failed: ${error?.message || error}` };
  }
}
