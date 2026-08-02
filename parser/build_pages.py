#!/usr/bin/env python3
from __future__ import annotations
import html, json, shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data/public/games.json'
GAME_ROOT=ROOT/'game'


def esc(v): return html.escape(str(v or ''))

def chips(items): return ''.join(f'<span>{esc(x)}</span>' for x in (items or []))

def cards(items, empty='Материалов нет'):
    if not items: return f'<p class="empty">{empty}</p>'
    return ''.join(f'<a class="material" href="{esc(x.get("url"))}" target="_blank" rel="noopener"><small>{esc(x.get("source_name") or x.get("domain"))}</small><h3>{esc(x.get("title"))}</h3><p>{esc(x.get("description"))}</p></a>' for x in items)

def page(g):
    i=g['identity']; e=g['editorial']; m=g['media']; c=g['classification']; co=g['companies']; r=g['ratings']; mats=g.get('materials',{}); sources=g.get('sources',[])
    shots=(m.get('screenshots') or [])[:12]
    thumbs=''.join(f'<button class="thumb"><img src="{esc(x)}" alt=""></button>' for x in shots)
    gallery=''.join(f'<img src="{esc(x)}" alt="Скриншот {esc(i.get("title"))}">' for x in shots)
    user=''
    if r.get('user_votes',0)>0:
        user=f'<div><strong>{esc(r.get("users"))}</strong><span>Игроки · {esc(r.get("user_votes"))} голосов</span></div>'
    src=''.join(f'<li><a href="{esc(x.get("url"))}" target="_blank" rel="noopener">{esc(x.get("title") or x.get("domain"))}</a></li>' for x in sources)
    return f'''<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(i.get('title'))} — Игропоиск</title><style>
:root{{--bg:#071017;--panel:#0d171f;--text:#f5f7f8;--muted:#91a0aa;--line:#1b2a35;--accent:#a7d433;--purple:#a55cff}}html[data-theme=light]{{--bg:#f4f5f7;--panel:#fff;--text:#12171b;--muted:#69737b;--line:#dfe3e6}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px Inter,Arial,sans-serif}}a{{color:inherit;text-decoration:none}}header{{height:64px;padding:0 28px;display:flex;align-items:center;border-bottom:1px solid var(--line);position:sticky;top:0;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(16px);z-index:20}}.logo{{font-weight:950;font-size:23px}}.theme{{margin-left:auto;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;width:40px;height:40px}}.hero{{min-height:610px;background:linear-gradient(90deg,rgba(2,8,12,.96),rgba(2,8,12,.25)),url('{esc(m.get('hero'))}') center/cover;display:flex;align-items:flex-end}}.wrap{{max-width:1450px;margin:auto;padding:0 28px;width:100%}}.hero-copy{{padding:70px 0 34px;max-width:760px}}h1{{font-size:58px;line-height:1;margin:0 0 15px}}.meta{{color:#d5dde2;margin-bottom:18px}}.tags span{{display:inline-block;border:1px solid #3b4b55;border-radius:999px;padding:6px 9px;margin:0 6px 6px 0}}.scorebox{{display:flex;gap:28px;margin-top:24px}}.scorebox div{{display:grid}}.scorebox strong{{font-size:38px;color:var(--accent)}}.scorebox span{{color:#d3dbe0;font-size:12px}}.thumbs{{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:0 0 24px}}.thumb{{padding:0;border:1px solid #51616d;background:none;border-radius:7px;overflow:hidden}}.thumb img{{display:block;width:100%;aspect-ratio:16/8;object-fit:cover}}.tabs{{display:flex;gap:24px;overflow:auto;border-bottom:1px solid var(--line);position:sticky;top:64px;background:var(--bg);z-index:15}}.tabs button{{border:0;background:none;color:var(--text);padding:18px 0;font-weight:800;white-space:nowrap}}.tabs button.active{{border-bottom:2px solid var(--purple)}}.panel{{display:none;padding:26px 0 50px}}.panel.active{{display:block}}.grid{{display:grid;grid-template-columns:1.45fr .75fr;gap:20px}}.card{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px}}.card h2{{margin-top:0}}.facts{{display:grid;grid-template-columns:130px 1fr;gap:12px}}.facts dt{{color:var(--muted)}}.facts dd{{margin:0}}.gallery{{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}}.gallery img{{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px}}.materials{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}.material{{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px}}.material small{{color:var(--accent)}}.material p,.empty{{color:var(--muted);line-height:1.55}}.sources li{{margin:8px 0}}@media(max-width:900px){{.grid{{grid-template-columns:1fr}}.thumbs{{grid-template-columns:repeat(3,1fr)}}.materials{{grid-template-columns:1fr 1fr}}}}@media(max-width:600px){{h1{{font-size:38px}}.wrap{{padding:0 14px}}.materials,.gallery{{grid-template-columns:1fr}}}}
</style></head><body><header><a class="logo" href="../../">ИГРОПОИСК</a><button class="theme" id="theme" aria-label="Сменить тему">◐</button></header><section class="hero"><div class="wrap"><div class="hero-copy"><div class="meta">{esc(g['release'].get('date_text'))} · {esc(', '.join(c.get('genres') or []))}</div><h1>{esc(i.get('title'))}</h1><p>{esc(e.get('short_description'))}</p><div class="tags">{chips(c.get('platforms'))}</div><div class="scorebox"><div><strong>{esc(r.get('igropoisk'))}</strong><span>Рейтинг Игропоиска</span></div>{user}</div></div>{thumbs}</div></section><div class="wrap"><nav class="tabs"><button class="active" data-tab="about">Об игре</button><button data-tab="reviews">Обзоры</button><button data-tab="gallery">Галерея</button><button data-tab="news">Новости</button><button data-tab="guides">Гайды</button><button data-tab="sources">Источники</button></nav><section class="panel active" id="about"><div class="grid"><article class="card"><h2>Об игре</h2><p>{esc(e.get('integrated_description'))}</p><h2>Особенности</h2><div class="tags">{chips(e.get('features'))}</div></article><aside class="card"><h2>Информация</h2><dl class="facts"><dt>Разработчик</dt><dd>{esc(', '.join(co.get('developers') or []))}</dd><dt>Издатель</dt><dd>{esc(', '.join(co.get('publishers') or []))}</dd><dt>Жанры</dt><dd>{esc(', '.join(c.get('genres') or []))}</dd><dt>Платформы</dt><dd>{esc(', '.join(c.get('platforms') or []))}</dd></dl></aside></div></section><section class="panel" id="reviews"><div class="materials">{cards(mats.get('reviews'), 'Обзоры не опубликованы')}</div></section><section class="panel" id="gallery"><div class="gallery">{gallery}</div></section><section class="panel" id="news"><div class="materials">{cards(mats.get('news'), 'Новости не опубликованы')}</div></section><section class="panel" id="guides"><div class="materials">{cards(mats.get('guides'), 'Гайды не опубликованы')}</div></section><section class="panel" id="sources"><div class="card"><ol class="sources">{src}</ol></div></section></div><script>
const root=document.documentElement;const saved=localStorage.getItem('theme');if(saved)root.dataset.theme=saved;document.getElementById('theme').onclick=()=>{{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('theme',root.dataset.theme)}};document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{{document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===b.dataset.tab))}});
</script></body></html>'''

def main():
    games=json.loads(DATA.read_text(encoding='utf-8')) if DATA.exists() else []
    GAME_ROOT.mkdir(exist_ok=True)
    for child in GAME_ROOT.iterdir():
        if child.is_dir(): shutil.rmtree(child)
    index=[]
    for g in games:
        if not g.get('publication',{}).get('gate_passed'): continue
        slug=g['identity']['slug']; out=GAME_ROOT/slug; out.mkdir(parents=True,exist_ok=True)
        (out/'index.html').write_text(page(g),encoding='utf-8')
        index.append({'slug':slug,'title':g['identity']['title'],'url':f'game/{slug}/','cover':g['media'].get('cover'),'hero':g['media'].get('hero'),'score':g['ratings'].get('igropoisk'),'year':g['release'].get('date_text'),'genres':g['classification'].get('genres',[]),'description':g['editorial'].get('short_description','')})
    (ROOT/'data/public/catalog.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Generated {len(index)} public pages')
if __name__=='__main__': main()
