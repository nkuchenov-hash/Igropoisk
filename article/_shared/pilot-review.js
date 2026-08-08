(() => {
  const root = document.querySelector('[data-pilot-review]');
  if (!root) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug = location.pathname.split('/').filter(Boolean).at(-1);
  const list = value => (value || []).map(item => `<li>${esc(item)}</li>`).join('');
  fetch(`/Igropoisk/data/pilot-reviews/${encodeURIComponent(slug)}.json`, {cache:'no-store'})
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(a => {
      if (!a || a.slug !== slug) throw new Error('Обзор не найден');
      document.title = `${a.title} — Игропоиск`;
      const sections = (a.sections || []).map((s,i) => `<section class="pilot-section" id="${esc(s.id || `section-${i+1}`)}"><div class="pilot-section__num">${String(i+1).padStart(2,'0')}</div><h2>${esc(s.heading)}</h2>${(s.paragraphs||[]).map(p=>`<p>${esc(p)}</p>`).join('')}<div class="pilot-section__refs">${(s.source_ids||[]).map(id=>`<a href="#${esc(id)}">${esc(id)}</a>`).join(' ')}</div></section>`).join('');
      const sources = (a.sources || []).map((s,i)=>`<a class="pilot-source" id="${esc(s.id)}" href="${esc(s.url)}" target="_blank" rel="noopener"><span>${String(i+1).padStart(2,'0')}</span><div><b>${esc(s.name)}</b><small>${esc(s.domain)} · ${esc(s.purpose||'профессиональный источник')}</small></div><strong>↗</strong></a>`).join('');
      root.innerHTML = `<header class="pilot-nav"><a href="/Igropoisk/">ИГРОПОИСК</a><nav><a href="/Igropoisk/top-250/">Топ-250</a><a href="/Igropoisk/game/${encodeURIComponent(a.game_slug)}/">К игре</a></nav></header><section class="pilot-hero"><div class="pilot-hero__inner"><div class="pilot-kicker">Обзор Игропоиска · пилот Top-250</div><h1>${esc(a.title)}</h1><p>${esc(a.dek)}</p><div class="pilot-meta"><strong>${Number(a.score).toFixed(1)} / 10</strong><span>${(a.sources||[]).length} профессиональных источника</span><span>${esc(a.author)}</span></div></div></section><main class="pilot-layout"><article><p class="pilot-lead">${esc(a.lead)}</p>${sections}<section class="pilot-verdict"><div class="pilot-kicker">Вердикт</div><h2>${Number(a.score).toFixed(1)} / 10</h2><p>${esc(a.verdict?.summary||'')}</p><div class="pilot-verdict__grid"><div><h3>Подойдёт</h3><ul>${list(a.verdict?.best_for)}</ul></div><div><h3>Не подойдёт</h3><ul>${list(a.verdict?.not_for)}</ul></div></div></section><section class="pilot-method"><div class="pilot-kicker">Методика</div><p>${esc(a.methodology)}</p></section><section class="pilot-sources"><div class="pilot-kicker">Источники</div><h2>Материалы, использованные при написании</h2>${sources}</section></article></main>`;
    })
    .catch(error => { root.innerHTML = `<main class="pilot-layout"><h1>Обзор временно недоступен</h1><p>${esc(error.message)}</p><p><a href="/Igropoisk/top-250/">← Топ-250</a></p></main>`; });
})();
