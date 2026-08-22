export const DEFAULT_ALLOWED_LATIN=['fallout','rpg'];

export const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;

export function lowerLatin(value,{allowedLatin=DEFAULT_ALLOWED_LATIN}={}){
  const allowed=new Set((allowedLatin||[]).map(word=>String(word).toLowerCase()));
  return [...String(value||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)]
    .map(match=>match[0])
    .filter(word=>!allowed.has(word.toLowerCase()));
}

export function tokenSet(value){
  return new Set(String(value||'').toLowerCase().normalize('NFKC').replace(/ё/g,'е').match(/[a-zа-я0-9]{3,}/gi)||[]);
}

export function tokenOverlap(a,b){
  const A=tokenSet(a),B=tokenSet(b);
  if(!A.size||!B.size)return 0;
  let shared=0;
  for(const token of A)if(B.has(token))shared++;
  return shared/Math.min(A.size,B.size);
}

export function nearDuplicate(a,b,threshold=0.72){
  return tokenOverlap(a,b)>=threshold;
}

const STRONG_INSTRUCTION_PATTERNS=[
  /\bnew\s+evidence\b/i,
  /\bcompact\s+evidence\b/i,
  /\bsource[- ]grounded\b/i,
  /\bsource\s+ids?\b/i,
  /\bsystem\s+prompt\b/i,
  /\bprompt\b/i,
  /нов(?:ый|ого)\s+абзац(?:а)?\s+долж/i,
  /абзац\s+должен\s+быть/i,
  /нужен\s+(?:ровно\s+)?один\s+.*абзац/i,
  /\d+\s*[–-]\s*\d+\s+русск(?:их|ого)\s+слов/i,
  /русск(?:их|ого)\s+слов/i,
  /латиниц\w*\s+запрещ/i,
  /не\s+добавл(?:яй|ять)\s+неподтвержд/i,
  /не\s+называй\s+издан/i,
  /предыдущ\w+\s+(?:попытк|вариант)/i,
  /вариант\w*\s+отклон/i,
  /технически\s+не\s+прош/i,
  /возьми\s+следующ/i,
  /перепиши\s+(?:его|вариант)/i,
  /используй\s+только/i,
  /сосредоточься\s+только/i,
  /верни\s+только/i,
  /строго\s+посвящ[её]н/i,
  /объ[её]м\s+от\s+\d+\s+до\s+\d+\s+слов/i,
  /минимум\s*[—:-]?\s*\d+\s+слов/i,
  /максимум\s*[—:-]?\s*\d+\s+слов/i,
  /не\s+повторяй\s+существующ/i,
  /не\s+пересказывай\s+уже\s+написан/i,
  /инструкц(?:ия|ии|ию|ий)/i,
  /как\s+языков(?:ая|ой)\s+модел/i,
  /я\s+не\s+могу\s+(?:выполнить|написать|предоставить)/i,
  /мне\s+нужно\s+(?:продолжить|написать|добавить|сформулировать)\s+(?:обзор|текст|абзац|раздел)/i,
  /(?:я\s+)?добавлю\s+(?:нов(?:ый|ого)\s+)?абзац/i,
  /без\s+упоминания\s+(?:процесса|требован|редакцион)/i,
  /нужно\s+перевести\s+английск/i,
  /можно\s+использовать\s+названи/i,
  /уже\s+(?:есть|написано)\s+\d+\s+слов/i,
  /продолж(?:ить|аю)\s+(?:готовый\s+)?(?:обзор|текст|раздел)/i
];

const WEAK_INSTRUCTION_PATTERNS=[
  /английск\w+\s+понят/i,
  /только\s+русск(?:ий|ого)\s+язык/i,
  /перевод(?:и|ить)\s+английск/i,
  /без\s+повторения\s+уже\s+существующ/i,
  /конкретн\w+\s+аспект/i,
  /для\s+одного\s+абзаца/i,
  /следующ\w+\s+нов\w+\s+(?:факт|наблюден|доказательств)/i,
  /в\s+разделе\s+уже\s+\d+\s+слов/i,
  /процесс\w*\s+написан/i
];

export function instructionLeakReasons(value){
  const text=String(value||'').trim();
  if(!text)return [];
  const reasons=[];
  for(const pattern of STRONG_INSTRUCTION_PATTERNS){
    if(pattern.test(text)){reasons.push(`instruction-leak:${pattern.source}`);break;}
  }
  let weakHits=0;
  for(const pattern of WEAK_INSTRUCTION_PATTERNS)if(pattern.test(text))weakHits++;
  if(weakHits>=2)reasons.push(`instruction-leak:weak-markers-${weakHits}`);
  if(/^\s*```|^\s*\{\s*"?(?:paragraph|text|answer)"?\s*:/i.test(text))reasons.push('instruction-leak:structured-wrapper');
  return reasons;
}

export function paragraphQualityReasons(paragraph,{existing=[],minWords=0,maxWords=Infinity,allowedLatin=DEFAULT_ALLOWED_LATIN}={}){
  const text=String(paragraph||'').trim();
  const reasons=[];
  const words=countWords(text);
  if(words<minWords)reasons.push(`too-short:${words}/${minWords}`);
  if(Number.isFinite(maxWords)&&words>maxWords)reasons.push(`too-long:${words}/${maxWords}`);
  const latin=[...new Set(lowerLatin(text,{allowedLatin}))];
  if(latin.length)reasons.push(`latin:${latin.slice(0,12).join(',')}`);
  reasons.push(...instructionLeakReasons(text));
  const duplicateIndex=(existing||[]).findIndex(other=>nearDuplicate(other,text));
  if(duplicateIndex>=0)reasons.push(`near-duplicate:${duplicateIndex+1}`);
  return reasons;
}

export function sanitizePersistedState(input,{allowedLatin=DEFAULT_ALLOWED_LATIN}={}){
  const state=input&&typeof input==='object'?structuredClone(input):input;
  if(!state||typeof state!=='object')return{state,changed:false,removed:[]};
  const removed=[];
  if(state.meta&&typeof state.meta==='object'){
    const metaText=[state.meta.title,state.meta.dek,state.meta.lead].filter(Boolean).join(' ');
    const metaReasons=instructionLeakReasons(metaText);
    if(metaReasons.length){removed.push({kind:'meta',reasons:metaReasons});state.meta=null;}
  }
  if(state.verdict&&typeof state.verdict==='object'){
    const verdictText=[state.verdict.summary,...(state.verdict.best_for||[]),...(state.verdict.not_for||[])].filter(Boolean).join(' ');
    const verdictReasons=instructionLeakReasons(verdictText);
    if(verdictReasons.length){removed.push({kind:'verdict',reasons:verdictReasons});state.verdict=null;}
  }
  if(state.sections&&typeof state.sections==='object'){
    for(const [sectionId,section] of Object.entries(state.sections)){
      if(!section||typeof section!=='object')continue;
      const original=Array.isArray(section.paragraphs)?section.paragraphs:[];
      const kept=[];
      for(let index=0;index<original.length;index++){
        const paragraph=String(original[index]||'').trim();
        const reasons=[];
        reasons.push(...instructionLeakReasons(paragraph));
        const latin=[...new Set(lowerLatin(paragraph,{allowedLatin}))];
        if(latin.length)reasons.push(`latin:${latin.slice(0,12).join(',')}`);
        const duplicateIndex=kept.findIndex(other=>nearDuplicate(other,paragraph));
        if(duplicateIndex>=0)reasons.push(`near-duplicate:${duplicateIndex+1}`);
        if(reasons.length){removed.push({kind:'paragraph',section:sectionId,index:index+1,reasons});continue;}
        kept.push(paragraph);
      }
      if(kept.length!==original.length)section.paragraphs=kept;
    }
  }
  if(removed.length){
    state.audit=null;
    state.updated_at=new Date().toISOString();
    state.quality_cleanup={checked_at:state.updated_at,removed};
  }
  return{state,changed:removed.length>0,removed};
}

export function articleInstructionLeakReasons(article){
  const reasons=[];
  const check=(label,value)=>{
    for(const reason of instructionLeakReasons(value))reasons.push(`${label}:${reason}`);
  };
  check('title',article?.title);
  check('dek',article?.dek);
  check('lead',article?.lead);
  for(const section of article?.sections||[]){
    for(let i=0;i<(section?.paragraphs||[]).length;i++)check(`${section.id||'section'}#${i+1}`,section.paragraphs[i]);
  }
  check('verdict',article?.verdict?.summary);
  for(let i=0;i<(article?.verdict?.best_for||[]).length;i++)check(`best_for#${i+1}`,article.verdict.best_for[i]);
  for(let i=0;i<(article?.verdict?.not_for||[]).length;i++)check(`not_for#${i+1}`,article.verdict.not_for[i]);
  return reasons;
}
