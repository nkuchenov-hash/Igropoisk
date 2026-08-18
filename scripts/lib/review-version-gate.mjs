const normalize=value=>String(value||'').normalize('NFKC').replace(/[™®©]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

export function isWrongVersionReview(item,canonicalTitle){
  if(item?.canonical_score_eligible===false)return false;
  const versionContext=String(item?.version_context||'').trim();
  if(versionContext&&!/^(?:canonical|base|original)$/i.test(versionContext))return true;
  const reviewTitle=normalize(item?.title||''),gameTitle=normalize(canonicalTitle);
  if(!reviewTitle||!gameTitle)return false;
  const at=reviewTitle.indexOf(gameTitle);if(at<0)return false;
  const suffix=reviewTitle.slice(at+gameTitle.length).trim();
  if(!suffix||/^(?:review|обзор|рецензия)\b/i.test(suffix))return false;
  const colon=suffix.match(/^[:：]\s*(.*?)\s+(?:review|обзор|рецензия)\b/i);
  if(colon&&String(colon[1]||'').trim())return true;
  if(/^[—–-]\s*(?:dlc|expansion|update|edition|remaster(?:ed)?|remake|episode|chapter|season)\b/i.test(suffix))return true;
  const url=String(item?.resolved_url||item?.url||'');
  return /\/(?:dlc|expansion|add-?on|episode|chapter|season)(?:\/|-)/i.test(url);
}
