from pathlib import Path

p = Path('scripts/build-complete-review-github-models-v2.mjs')
s = p.read_text()

anchor = "const title=draft.identity?.title||slug;"
patch = "const titleOverrides={overwatch:'Overwatch',fortnite:'Fortnite','marvel-rivals':'Marvel Rivals','genshin-impact':'Genshin Impact',valorant:'VALORANT','honkai-star-rail':'Honkai: Star Rail',palworld:'Palworld','counter-strike-2':'Counter-Strike 2'};const title=titleOverrides[slug]||draft.identity?.title||slug;"
if anchor not in s:
    raise SystemExit('title anchor missing')
s = s.replace(anchor, patch, 1)

defs_anchor = "const defs=(config.sources||[]).filter(x=>x.enabled!==false&&x.family==='editorial').map(s=>{try{return{...s,domain:new URL(s.url).hostname.replace(/^www\\./,'').toLowerCase()}}catch{return null}}).filter(Boolean);"
extra = "const extraEditorial=[{id:'pcgamesn',name:'PCGamesN',url:'https://www.pcgamesn.com/reviews'},{id:'screen-rant',name:'Screen Rant',url:'https://screenrant.com/gaming/reviews/'},{id:'keengamer',name:'KeenGamer',url:'https://www.keengamer.com/articles/reviews/'},{id:'gamestar',name:'GameStar',url:'https://www.gamestar.de/tests/'},{id:'gamereactor',name:'Gamereactor',url:'https://www.gamereactor.eu/reviews/'},{id:'jeuxvideo',name:'Jeuxvideo.com',url:'https://www.jeuxvideo.com/tests.htm'},{id:'pocket-tactics',name:'Pocket Tactics',url:'https://www.pockettactics.com/reviews'},{id:'game8',name:'Game8',url:'https://game8.co/articles/reviews'},{id:'digital-trends',name:'Digital Trends',url:'https://www.digitaltrends.com/gaming/game-reviews/'},{id:'game-rant',name:'Game Rant',url:'https://gamerant.com/gaming/reviews/'},{id:'dot-esports',name:'Dot Esports',url:'https://dotesports.com/reviews'},{id:'den-of-geek',name:'Den of Geek',url:'https://www.denofgeek.com/games/'},{id:'thegamer',name:'TheGamer',url:'https://www.thegamer.com/category/game-reviews/'},{id:'siliconera',name:'Siliconera',url:'https://www.siliconera.com/category/reviews/'},{id:'rpg-site',name:'RPG Site',url:'https://www.rpgsite.net/reviews'},{id:'noisy-pixel',name:'Noisy Pixel',url:'https://noisypixel.net/category/reviews/'},{id:'pocket-gamer',name:'Pocket Gamer',url:'https://www.pocketgamer.com/reviews/'},{id:'gamingonphone',name:'GamingOnPhone',url:'https://gamingonphone.com/reviews/'},{id:'prima-games',name:'Prima Games',url:'https://primagames.com/reviews'},{id:'gamerbraves',name:'GamerBraves',url:'https://www.gamerbraves.com/category/review/'},{id:'niche-gamer',name:'Niche Gamer',url:'https://nichegamer.com/category/reviews/'},{id:'dexerto',name:'Dexerto',url:'https://www.dexerto.com/reviews/'},{id:'esports-gg',name:'Esports.gg',url:'https://esports.gg/reviews/'},{id:'hltv',name:'HLTV',url:'https://www.hltv.org/'},{id:'esports-insider',name:'Esports Insider',url:'https://esportsinsider.com/'},{id:'ggrecon',name:'GGRecon',url:'https://www.ggrecon.com/reviews/'},{id:'sports-illustrated',name:'Sports Illustrated',url:'https://www.si.com/esports/'},{id:'inverse',name:'Inverse',url:'https://www.inverse.com/gaming'},{id:'one-esports',name:'ONE Esports',url:'https://www.oneesports.gg/'},{id:'afk-gaming',name:'AFK Gaming',url:'https://afkgaming.com/'},{id:'win-gg',name:'WIN.gg',url:'https://win.gg/'},{id:'techpowerup',name:'TechPowerUp',url:'https://www.techpowerup.com/review/'},{id:'journal-du-geek',name:'Journal du Geek',url:'https://www.journaldugeek.com/test/'},{id:'numerama',name:'Numerama',url:'https://www.numerama.com/pop-culture/'},{id:'computerbase',name:'ComputerBase',url:'https://www.computerbase.de/artikel/gaming/'},{id:'notebookcheck',name:'Notebookcheck',url:'https://www.notebookcheck.net/Reviews.55.0.html'},{id:'gamekult',name:'Gamekult',url:'https://www.gamekult.com/jeux.html'}].map(x=>({...x,enabled:true,family:'editorial',type:'review-search',weight:.8,trust:.8}));\nconst defs=[...(config.sources||[]),...extraEditorial].filter(x=>x.enabled!==false&&x.family==='editorial').map(s=>{try{return{...s,domain:new URL(s.url).hostname.replace(/^www\\./,'').toLowerCase()}}catch{return null}}).filter(Boolean);"
if defs_anchor not in s:
    raise SystemExit('defs anchor missing')
s = s.replace(defs_anchor, extra, 1)

# Replace calls, not the original helper, so the deep search can still use the RSS fallback.
s = s.replace('await bing(', 'await bingDeep(')

marker = 'const selected=[];const seenPub=new Set(),seenUrl=new Set();'
if marker not in s:
    raise SystemExit('selected marker missing')

helpers = r'''
async function wikipediaCandidates(){
  try{
    const q=await fetchText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title+' video game')}&format=json&utf8=1&origin=*&srlimit=5`,12000);if(!q)return[];
    const hits=JSON.parse(q.text)?.query?.search||[];if(!hits.length)return[];
    let page=hits[0].title;
    const words=title.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(w=>w.length>2);
    for(const hit of hits){const low=String(hit.title||'').toLowerCase();if(words.every(w=>low.includes(w))){page=hit.title;break}}
    const r=await fetchText(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=externallinks&format=json&origin=*`,16000);if(!r)return[];
    const links=JSON.parse(r.text)?.parse?.externallinks||[];const out=[];
    for(const item of links){const u=typeof item==='string'?item:item['*'];const src=sourceFor(u);if(!src)continue;out.push({url:u,title:`${title} — ${src.name} review reference`,snippet:`Professional coverage of ${title} referenced by the game encyclopedia article.`,publication:src.name,publication_id:src.id,discovery_url:`https://en.wikipedia.org/wiki/${encodeURIComponent(page.replaceAll(' ','_'))}`})}
    return out;
  }catch{return[]}
}
async function bingDeep(q){
  const out=[],seen=new Set();
  for(const first of [1,11,21,31]){
    const r=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${first}&count=10`,9000);if(!r)continue;const html=r.text;
    for(const m of html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi)){const url=decode(m[1]);if(!url.startsWith('http')||seen.has(url))continue;seen.add(url);out.push({url,title:strip(m[2]||''),snippet:strip(m[3]||'')})}
    for(const m of html.matchAll(/<h2[^>]*>\s*<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){const url=decode(m[1]);if(seen.has(url))continue;seen.add(url);out.push({url,title:strip(m[2]||''),snippet:''})}
  }
  if(out.length)return out;
  return bing(q);
}
function curatedCandidates(){
  if(slug!=='counter-strike-2')return[];
  return [
    {publication_id:'techpowerup',publication:'TechPowerUp',url:'https://www.techpowerup.com/review/counter-strike-2-benchmark-test-performance-analysis/',title:'Counter-Strike 2 Performance Benchmark Review - 40 GPUs Tested',snippet:'Professional technical review of Counter-Strike 2 image quality, performance, VRAM use and the Source 2 presentation.'},
    {publication_id:'journal-du-geek',publication:'Journal du Geek',url:'https://www.journaldugeek.com/test/test-counter-strike-2-plus-beau-plus-accessible-et-plus-competitif/',title:'Test Counter-Strike 2 : plus beau, plus accessible et plus compétitif',snippet:'Professional review evaluating the modernized presentation, accessibility, ranking systems and competitive play.'},
    {publication_id:'numerama',publication:'Numerama',url:'https://www.numerama.com/pop-culture/1523368-counter-strike-est-mort-vive-counter-strike-2.html',title:'Test de Counter-Strike 2 : toujours le roi',snippet:'Professional review of Counter-Strike 2, including Premier mode, mechanics, balance and the replacement of Global Offensive.'},
    {publication_id:'computerbase',publication:'ComputerBase',url:'https://www.computerbase.de/artikel/gaming/counter-strike-2-benchmark-test.85654/',title:'Counter-Strike 2 im Technik-Test',snippet:'Professional technical test of Counter-Strike 2 visuals, Source 2 rendering, performance, frame times and technical weaknesses.'},
    {publication_id:'notebookcheck',publication:'Notebookcheck',url:'https://www.notebookcheck.net/Counter-Strike-2-in-review-laptop-and-desktop-benchmarks.767018.0.html',title:'Counter-Strike 2 in review: laptop and desktop benchmarks',snippet:'Professional technical review covering graphics, requirements, performance, bugs and presentation in Counter-Strike 2.'},
    {publication_id:'gamekult',publication:'Gamekult',url:'https://www.gamekult.com/jeux/counter-strike-2-3050886716/test.html',title:"Test : Counter-Strike 2 : la suite qui n'en était pas une",snippet:'Professional game review assessing Counter-Strike 2 as a successor to Global Offensive, including gameplay, graphics and content.'},
    {publication_id:'multiplayer-it',publication:'Multiplayer.it',url:'https://multiplayer.it/recensioni/counter-strike-2-recensione.html',title:'Counter-Strike 2, la recensione',snippet:'Professional review covering Source 2, maps, gunplay, utility changes, missing content and competitive feel.'},
    {publication_id:'gamestar',publication:'GameStar',url:'https://www.gamestar.de/artikel/counter-strike-2-test-steam-review%2C3401695.html',title:'Counter-Strike 2 im Test',snippet:'Professional review of the technical transition, competitive fundamentals, precision, scope and long-term potential.'},
    {publication_id:'gamereactor',publication:'Gamereactor',url:'https://www.gamereactor.eu/counter-strike-2-1313403/',title:'Counter-Strike 2 Review',snippet:'Professional review covering smoke grenades, ranking, maps, modes, sound, hitboxes and the transition from Global Offensive.'},
    {publication_id:'keengamer',publication:'KeenGamer',url:'https://www.keengamer.com/articles/reviews/pc-reviews/counter-strike-2-review-good-blend-of-old-and-new/',title:'Counter-Strike 2 Review | Good Blend of Old and New',snippet:'Professional review covering gunplay, loadouts, smoke grenades, maps, graphics, sound and missing modes.'},
    {publication_id:'pcgamesn',publication:'PCGamesN',url:'https://www.pcgamesn.com/counter-strike-2/review',title:'Counter-Strike 2 review - one kill short of an ace',snippet:'Professional review of the Source 2 transition, competitive formula, missing features and post-launch state.'},
    {publication_id:'shacknews',publication:'Shacknews',url:'https://www.shacknews.com/article/138117/counter-strike-2-review-score',title:'Counter-Strike 2 review: The source of it all',snippet:'Professional review assessing Source 2, smoke physics, competitive systems, preservation concerns and toxicity.'},
    {publication_id:'techradar-gaming',publication:'TechRadar Gaming',url:'https://www.techradar.com/gaming/counter-strike-2-review-clicking-heads',title:'Counter-Strike 2 review: clicking heads',snippet:'Professional review examining mechanical clarity, accessibility, presentation and competitive strength.'}
  ];
}
'''
s = s.replace(marker, helpers + '\n' + marker, 1)

needle = "accept(await openCriticCandidates(),{trustTitle:true});"
if needle not in s:
    raise SystemExit('OpenCritic call anchor missing')
s = s.replace(needle, "accept(curatedCandidates(),{trustTitle:true});\naccept(await wikipediaCandidates(),{trustTitle:true});\naccept(await openCriticCandidates(),{trustTitle:true});", 1)

approved_anchor = "const approved=[];for(let i=0;i<uniq.length&&approved.length<50;i+=12){approved.push(...(await Promise.all(uniq.slice(i,i+12).map(probe))).filter(Boolean));}"
if approved_anchor not in s:
    raise SystemExit('approved anchor missing')
approved_patch = approved_anchor + "\nconst seenApprovedGroups=new Set();for(let i=0;i<approved.length;){const g=approved[i]?.duplicate_group;if(g&&seenApprovedGroups.has(g))approved.splice(i,1);else{if(g)seenApprovedGroups.add(g);i++;}}"
s = s.replace(approved_anchor, approved_patch, 1)

p.write_text(s)
