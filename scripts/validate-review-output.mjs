import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requestedSlug=process.argv[2]||'';
const policy=JSON.parse(fs.readFileSync(path.join(root,'config/parsers/review-media-policy.json'),'utf8'));
const balance=policy.article_balance||{};
const quality=policy.quality_gate||{};
const articlesDir=path.join(root,'data/articles');
const mediaDir=path.join(root,'data/article-media');
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const url=new URL(value);url.hash='';return `${url.origin}${url.pathname}${url.search}`}catch{return String(value||'')}};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const imagesFor=section=>(section.images?.length?section.images:(section.image?[section.image]:[])).filter(image=>image?.url);
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
  const words=countWords([article.lead,...sections.flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
  const allImages=sections.flatMap(imagesFor);
  const urls=allImages.map(image=>canonical(image.url));
  const duplicateUrls=urls.filter((url,index)=>urls.indexOf(url)!==index);
  const duplicateGroups=allImages.map(image=>image.duplicate_group||image.quality?.duplicate_group).filter(Boolean);
  const repeatedGroups=duplicateGroups.filter((group,index)=>duplicateGroups.indexOf(group)!==index);
  const errors=[];

  if(words<Number(balance.minimum_words||2200))errors.push(`article words ${words}/${balance.minimum_words}`);
  if(sections.length<Number(balance.minimum_sections||8))errors.push(`sections ${sections.length}/${balance.minimum_sections}`);
  for(const section of sections){
    const sectionWords=countWords((section.paragraphs||[]).join(' '));
    const images=imagesFor(section);
    if(sectionWords<Number(balance.minimum_words_per_section||220))errors.push(`${section.id}: words ${sectionWords}/${balance.minimum_words_per_section}`);
    if(images.length<Number(balance.screenshots_per_section?.minimum||3))errors.push(`${section.id}: images ${images.length}/${balance.screenshots_per_section?.minimum}`);
  }
  if(allImages.length<Number(balance.minimum_total_screenshots||30))errors.push(`total images ${allImages.length}/${balance.minimum_total_screenshots}`);
  if(new Set(urls).size<Number(balance.minimum_unique_screenshots||30))errors.push(`unique images ${new Set(urls).size}/${balance.minimum_unique_screenshots}`);
  if(duplicateUrls.length)errors.push(`duplicate URLs: ${[...new Set(duplicateUrls)].join(', ')}`);
  if(repeatedGroups.length)errors.push(`duplicate scenes: ${[...new Set(repeatedGroups)].join(', ')}`);

  const minWidth=Number(quality.minimum_width_historical||quality.minimum_width_modern||480);
  const minHeight=Number(quality.minimum_height_historical||quality.minimum_height_modern||480);
  const minBytes=Number(quality.minimum_bytes_historical||quality.minimum_bytes_modern||25000);
  const minAspect=Number(quality.minimum_aspect_ratio||0.75);
  const maxAspect=Number(quality.maximum_aspect_ratio||2.6);
  const minConfidence=Number(quality.visual_quality_confidence||0.92);
  const minSharpness=Number(quality.minimum_sharpness||0.82);
  const minCompression=Number(quality.minimum_compression_quality||0.78);
  const minReadability=Number(quality.minimum_readability||0.72);
  const minComposition=Number(quality.minimum_composition_quality||0.76);
  const minRenderSuitability=Number(quality.minimum_render_suitability||0.84);

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
    validator:'review-output',slug:article.slug,checked_at:new Date().toISOString(),passed:errors.length===0,
    words,sections:sections.length,total_images:allImages.length,unique_images:new Set(urls).size,
    quality_thresholds:{technicalFloor:{minWidth,minHeight,minBytes},minConfidence,minSharpness,minCompression,minReadability,minComposition,minRenderSuitability},errors
  };
  const reportPath=path.join(root,'data/parser-runs',`review-output-${article.slug}.json`);
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`);
  if(errors.length){failed=true;console.error(`${article.slug}: blocked\n- ${errors.join('\n- ')}`)}
  else console.log(`${article.slug}: passed — ${words} words, ${allImages.length} visually approved unique screenshots`);
}
if(failed)process.exit(2);
