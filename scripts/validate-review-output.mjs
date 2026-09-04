import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requestedSlug=process.argv[2]||'';
const policy=JSON.parse(fs.readFileSync(path.join(root,'config/parsers/review-media-policy.json'),'utf8'));
const editorialPolicy=JSON.parse(fs.readFileSync(path.join(root,'config/review-editorial-policy.json'),'utf8'));
const balance=policy.article_balance||{};
const quality=policy.quality_gate||{};
const articleRules=editorialPolicy.article||{};
const articlesDir=path.join(root,'data/articles');
const mediaDir=path.join(root,'data/article-media');
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const url=new URL(value);url.hash='';return `${url.origin}${url.pathname}${url.search}`}catch{return String(value||'')}};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const imagesFor=section=>(section.images?.length?section.images:(section.image?[section.image]:[])).filter(image=>image?.url);
const normalize=value=>String(value||'').toLowerCase().replace(/[ё]/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
const files=requestedSlug?[`${requestedSlug}.json`]:fs.readdirSync(articlesDir).filter(name=>name.endsWith('.json'));
let failed=false;

for(const name of files){
  const articlePath=path.join(articlesDir,name);
  if(!fs.existsSync(articlePath)){console.error(`${name}: article not found`);failed=true;continue}
  const article=read(articlePath);
  const mediaPath=path.join(mediaDir,name);
  if(fs.existsSync(mediaPath)){
    const media=read(mediaPath);
    const map=new Map((media.sections||[]).map(section=>[section.id,section.images||[]]));
    article.sections=(article.sections||[]).map(section=>map.has(section.id)?{...section,images:map.get(section.id)}:section);
  }

  const sections=article.sections||[];
  const paragraphs=[article.lead,...sections.flatMap(section=>section.paragraphs||[]),article.verdict?.summary].filter(Boolean);
  const articleText=paragraphs.join('\n\n');
  const lowerText=articleText.toLowerCase();
  const words=countWords(articleText);
  const allImages=sections.flatMap(imagesFor);
  const urls=allImages.map(image=>canonical(image.url));
  const duplicateUrls=urls.filter((url,index)=>urls.indexOf(url)!==index);
  const duplicateGroups=allImages.map(image=>image.duplicate_group||image.quality?.duplicate_group).filter(Boolean);
  const repeatedGroups=duplicateGroups.filter((group,index)=>duplicateGroups.indexOf(group)!==index);
  const errors=[];
  const warnings=[];

  const minWords=Number(articleRules.minimum_words||balance.minimum_words||1800);
  const minSections=Number(articleRules.minimum_sections||balance.minimum_sections||7);
  const maxSections=Number(articleRules.maximum_sections||balance.maximum_sections||10);
  if(words<minWords)errors.push(`article words ${words}/${minWords}`);
  if(sections.length<minSections)errors.push(`sections ${sections.length}/${minSections}`);
  if(sections.length>maxSections)errors.push(`sections ${sections.length}/${maxSections} maximum`);
  for(const section of sections){
    const sectionWords=countWords((section.paragraphs||[]).join(' '));
    const images=imagesFor(section);
    if(sectionWords<Number(balance.minimum_words_per_section||170))errors.push(`${section.id}: words ${sectionWords}/${balance.minimum_words_per_section||170}`);
    if(images.length<Number(balance.screenshots_per_section?.minimum||1))errors.push(`${section.id}: images ${images.length}/${balance.screenshots_per_section?.minimum||1}`);
  }
  if(allImages.length<Number(balance.minimum_total_screenshots||7))errors.push(`total images ${allImages.length}/${balance.minimum_total_screenshots||7}`);
  if(new Set(urls).size<Number(balance.minimum_unique_screenshots||7))errors.push(`unique images ${new Set(urls).size}/${balance.minimum_unique_screenshots||7}`);
  if(duplicateUrls.length)errors.push(`duplicate URLs: ${[...new Set(duplicateUrls)].join(', ')}`);
  if(repeatedGroups.length)errors.push(`duplicate scenes: ${[...new Set(repeatedGroups)].join(', ')}`);

  // Review Skill v1 deterministic editorial checks.
  const blacklistHits=(editorialPolicy.language_blacklist||[]).filter(phrase=>lowerText.includes(String(phrase).toLowerCase()));
  if(blacklistHits.length)errors.push(`evergreen language blacklist: ${blacklistHits.join(', ')}`);
  const processHits=(editorialPolicy.process_leakage_blacklist||[]).filter(phrase=>lowerText.includes(String(phrase).toLowerCase()));
  if(processHits.length)errors.push(`source/process leakage: ${processHits.join(', ')}`);
  const relativePresentPatterns=[/\bсегодня\b/iu,/\bв наши дни\b/iu,/\bна сегодняшний день\b/iu,/\bв настоящее время\b/iu,/\bсейчас,?\s+(?:игра|она|он|это)\b/iu];
  const relativeHits=relativePresentPatterns.filter(rx=>rx.test(articleText)).map(rx=>rx.source);
  if(relativeHits.length)errors.push('date-relative present-day framing detected');
  if(/\b2026\s*(?:год|года|году|г\.)?\b/iu.test(articleText))errors.push('current-year framing detected');

  const headings=sections.map(section=>String(section.heading||'').trim()).filter(Boolean);
  const normalizedHeadings=headings.map(normalize);
  const duplicateHeadings=normalizedHeadings.filter((heading,index)=>heading&&normalizedHeadings.indexOf(heading)!==index);
  if(duplicateHeadings.length)errors.push(`duplicate section headings: ${[...new Set(duplicateHeadings)].join(', ')}`);
  const hardGenericHeadings=new Set(['геймплей','графика','сюжет','итоги','плюсы и минусы','что устарело','что состарилось','что сегодня мешает']);
  const genericHeadings=headings.filter(heading=>hardGenericHeadings.has(normalize(heading))||/^что (?:в .+ )?(?:устарело|состарилось|сегодня мешает)/iu.test(heading));
  if(genericHeadings.length)errors.push(`generic/age-framed headings: ${genericHeadings.join(' | ')}`);

  const meaningfulParagraphs=paragraphs.filter(p=>countWords(p)>0);
  const veryShortParagraphs=meaningfulParagraphs.filter(p=>countWords(p)<10);
  const shortRatio=meaningfulParagraphs.length?veryShortParagraphs.length/meaningfulParagraphs.length:0;
  if(veryShortParagraphs.length>=4&&shortRatio>0.22)errors.push(`LLM-style short-paragraph rhythm: ${veryShortParagraphs.length}/${meaningfulParagraphs.length}`);
  const conclusionWords=countWords(article.verdict?.summary||'');
  if(conclusionWords<45)warnings.push(`conclusion is very short: ${conclusionWords} words`);
  if(article.source_gate?.fixed_count_required===true)errors.push('fixed review-source count gate is forbidden by Review Skill v1');
  if(article.validation?.editorial_audit?.passed===false)errors.push('same-model editorial audit failed');

  const minWidth=Number(quality.minimum_width_historical||quality.minimum_width_modern||480);
  const minHeight=Number(quality.minimum_height_historical||quality.minimum_height_modern||270);
  const minBytes=Number(quality.minimum_bytes_historical||quality.minimum_bytes_modern||25000);
  const minAspect=Number(quality.minimum_aspect_ratio||0.75);
  const maxAspect=Number(quality.maximum_aspect_ratio||2.6);
  const minConfidence=Number(quality.visual_quality_confidence||0.78);
  const minSharpness=Number(quality.minimum_sharpness||0.72);
  const minCompression=Number(quality.minimum_compression_quality||0.7);
  const minReadability=Number(quality.minimum_readability||0.68);
  const minComposition=Number(quality.minimum_composition_quality||0.68);
  const minRenderSuitability=Number(quality.minimum_render_suitability||0.72);

  for(const image of allImages){
    const width=Number(image.width||0),height=Number(image.height||0),bytes=Number(image.bytes||0);
    const mime=String(image.mime||'').toLowerCase();
    const aspect=width&&height?width/height:0;
    const audit=image.quality||{};
    const confidence=Number(audit.confidence||0);
    const sharpness=Number(audit.sharpness||0);
    const compression=Number(audit.compression||0);
    const readability=Number(audit.readability||0);
    const composition=Number(audit.composition||0);
    const renderSuitability=Number(audit.render_suitability||0);

    if(quality.require_known_dimensions&&(!width||!height))errors.push(`unknown dimensions: ${image.url}`);
    if(width<minWidth||height<minHeight)errors.push(`technical size floor ${width}x${height}/${minWidth}x${minHeight}: ${image.url}`);
    if(bytes<minBytes)errors.push(`technical byte floor ${bytes}/${minBytes}: ${image.url}`);
    if(quality.require_image_mime_type&&!mime.startsWith('image/'))errors.push(`invalid mime ${mime||'missing'}: ${image.url}`);
    if(aspect<minAspect||aspect>maxAspect)errors.push(`aspect ${aspect.toFixed(3)} outside ${minAspect}-${maxAspect}: ${image.url}`);
    if(confidence<minConfidence)errors.push(`confidence ${confidence}/${minConfidence}: ${image.url}`);
    if(sharpness<minSharpness)errors.push(`sharpness ${sharpness}/${minSharpness}: ${image.url}`);
    if(compression<minCompression)errors.push(`compression ${compression}/${minCompression}: ${image.url}`);
    if(readability<minReadability)errors.push(`readability ${readability}/${minReadability}: ${image.url}`);
    if(composition<minComposition)errors.push(`composition ${composition}/${minComposition}: ${image.url}`);
    if(renderSuitability<minRenderSuitability)errors.push(`render suitability ${renderSuitability}/${minRenderSuitability}: ${image.url}`);
    if(audit.visible_upscale===true)errors.push(`visible upscale: ${image.url}`);
    if(audit.soft_resampling===true)errors.push(`soft resampling: ${image.url}`);
    if(audit.stretched===true)errors.push(`stretched image: ${image.url}`);
    if(audit.muddy===true)errors.push(`muddy image: ${image.url}`);
  }

  const report={
    validator:'review-output-v1',slug:article.slug,checked_at:new Date().toISOString(),passed:errors.length===0,
    words,sections:sections.length,total_images:allImages.length,unique_images:new Set(urls).size,
    editorial:{blacklist_hits:blacklistHits,process_leakage_hits:processHits,relative_present_day_hits:relativeHits,generic_headings:genericHeadings,duplicate_headings:[...new Set(duplicateHeadings)],very_short_paragraphs:veryShortParagraphs.length,paragraphs:meaningfulParagraphs.length,short_paragraph_ratio:Number(shortRatio.toFixed(3)),conclusion_words:conclusionWords,warnings},
    quality_thresholds:{technicalFloor:{minWidth,minHeight,minBytes},minConfidence,minSharpness,minCompression,minReadability,minComposition,minRenderSuitability},errors
  };
  const reportPath=path.join(root,'data/parser-runs',`review-output-${article.slug}.json`);
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`);
  if(errors.length){failed=true;console.error(`${article.slug}: blocked\n- ${errors.join('\n- ')}`)}
  else console.log(`${article.slug}: passed — ${words} words, ${allImages.length} visually approved unique screenshots, evergreen QC passed`);
}
if(failed)process.exit(2);
