from pathlib import Path

p = Path('scripts/build-complete-review-github-models-v2.mjs')
s = p.read_text()

anchor = "const title=draft.identity?.title||slug;"
patch = "const titleOverrides={overwatch:'Overwatch',fortnite:'Fortnite','marvel-rivals':'Marvel Rivals','genshin-impact':'Genshin Impact',valorant:'VALORANT','honkai-star-rail':'Honkai: Star Rail',palworld:'Palworld','counter-strike-2':'Counter-Strike 2'};const title=titleOverrides[slug]||draft.identity?.title||slug;"
if anchor not in s:
    raise SystemExit('title anchor missing')
s = s.replace(anchor, patch, 1)

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
  for(const first of [1,11]){
    const r=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${first}&count=10`,9000);if(!r)continue;const html=r.text;
    for(const m of html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi)){const url=decode(m[1]);if(!url.startsWith('http')||seen.has(url))continue;seen.add(url);out.push({url,title:strip(m[2]||''),snippet:strip(m[3]||'')})}
    for(const m of html.matchAll(/<h2[^>]*>\s*<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){const url=decode(m[1]);if(seen.has(url))continue;seen.add(url);out.push({url,title:strip(m[2]||''),snippet:''})}
  }
  if(out.length)return out;
  return bing(q);
}
'''
s = s.replace(marker, helpers + '\n' + marker, 1)

needle = "accept(await openCriticCandidates(),{trustTitle:true});"
if needle not in s:
    raise SystemExit('OpenCritic call anchor missing')
s = s.replace(needle, "accept(await wikipediaCandidates(),{trustTitle:true});\naccept(await openCriticCandidates(),{trustTitle:true});", 1)

p.write_text(s)
