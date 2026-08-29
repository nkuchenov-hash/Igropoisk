const REVIEW_NOISE=new Set(['review','reviews','reviewed','retro','retroview','retrospective','opinion','recenz','recenzja','обзор','обзоры','рецензия','рецензии','ретро','мнение','вердикт','game','games','gaming','videogame','video','игра','игры','pc','ps3','ps4','ps5','xbox','switch','steam','windows','mac','linux','analysis','análisis','analisis']);

export const normalizeReviewIdentity=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const tokens=value=>normalizeReviewIdentity(value).split(' ').filter(Boolean);
const phrasePresent=(hay,phrase)=>Boolean(phrase)&&` ${hay} `.includes(` ${phrase} `);
const unique=items=>[...new Set(items.filter(Boolean))];
const meaningfulCompany=value=>{const normalized=normalizeReviewIdentity(value).replace(/\b(?:inc|llc|ltd|limited|gmbh|corp|corporation|studio|studios|games|game|entertainment|interactive|software|co|company)\b/g,' ').replace(/\s+/g,' ').trim();return normalized.length>=3?normalized:normalizeReviewIdentity(value)};
const extractYear=value=>Number(String(value||'').match(/(?:19|20)\d{2}/)?.[0]||0)||null;
const publishedYearFromHtml=html=>{
  const raw=String(html||'');
  for(const rx of [
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /name=["']date["'][^>]*content=["']([^"']+)["']/i,
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i
  ]){const match=raw.match(rx);const year=extractYear(match?.[1]);if(year)return year}
  return null;
};

export function buildReviewIdentityProfile(draft,slug=''){
  const title=String(draft?.identity?.title||slug||'').trim();
  const aliases=Array.isArray(draft?.identity?.aliases)?draft.identity.aliases:[];
  const titlePhrases=unique([title,...aliases].map(normalizeReviewIdentity).filter(Boolean));
  const primary=titlePhrases[0]||normalizeReviewIdentity(slug);
  const primaryTokens=tokens(primary).filter(token=>token.length>1||/^\d+$/.test(token));
  const releaseYear=extractYear(draft?.release?.date||draft?.release?.date_text||draft?.release?.canonical_date_text||draft?.release?.store_date_text);
  const appid=Number(draft?.identity?.steam_appid||0)||null;
  const developers=Array.isArray(draft?.companies?.developers)?draft.companies.developers:[];
  const publishers=Array.isArray(draft?.companies?.publishers)?draft.companies.publishers:[];
  const companies=unique([...developers,...publishers].flatMap(value=>[normalizeReviewIdentity(value),meaningfulCompany(value)]).filter(value=>value.length>=3));
  const weakTitle=primaryTokens.length<=1||primary.replace(/\s/g,'').length<=5;
  return{slug,title,title_phrases:titlePhrases,primary,primary_tokens:primaryTokens,release_year:releaseYear,steam_appid:appid,companies,weak_title:weakTitle};
}

export function evaluateReviewSourceIdentity(profile,{title='',url='',publication='',pageText='',html='',publishedAt=''}={}){
  const candidateTitle=normalizeReviewIdentity(title);
  const candidateUrl=normalizeReviewIdentity(String(url).replace(/https?:\/\//gi,' ').replace(/[/?#=&._-]+/g,' '));
  const text=normalizeReviewIdentity(pageText);
  const combined=`${candidateTitle} ${candidateUrl} ${text}`.trim();
  const matchedPhrase=(profile.title_phrases||[]).find(phrase=>phrasePresent(combined,phrase))||'';
  if(!matchedPhrase)return{accepted:false,reason:'canonical title/alias missing',evidence:[],conflicts:['title_missing']};

  const evidence=[];
  const conflicts=[];
  if(profile.steam_appid&&new RegExp(`(?:app[ /_-]?|steam[ /_-]?)${profile.steam_appid}\\b`).test(combined))evidence.push('steam_appid');
  for(const company of profile.companies||[])if(phrasePresent(combined,company)){evidence.push(`company:${company}`);break}

  const publishedYear=extractYear(publishedAt)||publishedYearFromHtml(html);
  if(profile.release_year&&publishedYear){
    if(publishedYear<profile.release_year-1)conflicts.push(`published_before_game:${publishedYear}<${profile.release_year}`);
    else evidence.push(`publication_year:${publishedYear}`);
  }

  if(profile.weak_title){
    const publicationTokens=new Set(tokens(publication));
    const titleTokens=new Set(profile.primary_tokens||[]);
    const companyTokens=new Set((profile.companies||[]).flatMap(tokens));
    const residue=tokens(candidateTitle).filter(token=>!titleTokens.has(token)&&!REVIEW_NOISE.has(token)&&!publicationTokens.has(token)&&!companyTokens.has(token)&&token.length>1);
    if(residue.length)conflicts.push(`ambiguous_title_qualifier:${residue.join(',')}`);
    const strongEvidence=evidence.some(item=>item==='steam_appid'||item.startsWith('company:')||item.startsWith('publication_year:'));
    if(!strongEvidence)conflicts.push('weak_title_without_corroboration');
  }

  const accepted=conflicts.length===0;
  return{accepted,reason:accepted?'strong game identity verified':conflicts.join('; '),evidence:unique(['title_or_alias',...evidence]),conflicts:unique(conflicts),published_year:publishedYear,weak_title:profile.weak_title};
}
