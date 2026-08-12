export const canonicalPressText=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();

const GROUP_RULES=[
  [/^(?:[a-z]{2}\s+)?ign(?:\s|$)/,'ign'],
  [/\bign\b/,'ign'],
  [/\bgamesradar\b/,'gamesradar'],
  [/\bgamespot\b/,'gamespot'],
  [/\bgamereactor\b/,'gamereactor'],
  [/\beurogamer\b/,'eurogamer'],
  [/\bpolygon\b/,'polygon'],
  [/\bkotaku\b/,'kotaku'],
  [/\bpc gamer\b/,'pc gamer'],
  [/\brock paper shotgun\b/,'rock paper shotgun'],
  [/\bvideo games chronicle\b|\bvgc\b/,'vgc'],
  [/\bdestructoid\b/,'destructoid'],
  [/\bgematsu\b/,'gematsu'],
  [/\bpush square\b/,'push square'],
  [/\bnintendo life\b/,'nintendo life'],
  [/\bwindows central\b/,'windows central'],
  [/\bthe gamer\b|\bthegamer\b/,'thegamer'],
  [/\bgame informer\b/,'game informer']
];

export function pressPublisherGroup(value){
  const key=canonicalPressText(value);
  for(const [pattern,group] of GROUP_RULES)if(pattern.test(key))return group;
  return key.replace(/^www\s+/,'').replace(/\s+(?:com|net|org)$/,'').trim();
}

export function pressTitleMatches(gameTitle,articleTitle){
  const wanted=canonicalPressText(String(gameTitle||'').replace(/[™®]/g,''));
  const observed=canonicalPressText(articleTitle);
  if(!wanted||!observed)return false;
  const tokens=wanted.split(' ').filter(Boolean);
  if(tokens.length===1){
    const token=tokens[0];
    const first=observed.split(' ').filter(Boolean);
    if(first[0]!==token)return false;
    const next=first[1]||'';
    const allowedNext=new Set(['preview','review','release','launch','game','gameplay','demo','trailer','official','hands','is','gets','adds','announced','coming','delayed','date','developer']);
    return allowedNext.has(next);
  }
  return (` ${observed} `).includes(` ${wanted} `);
}

export function sourceDisappearanceOnly(editorial){
  if(!(editorial?.needs_review||editorial?.status==='needs_review'))return false;
  const notes=(editorial?.notes||[]).map(value=>String(value||'').trim()).filter(Boolean);
  return notes.length>0&&notes.every(note=>/исчезла из текущей выдачи источника|disappeared from (?:the )?current source/i.test(note));
}
