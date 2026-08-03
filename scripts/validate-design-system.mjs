import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const errors=[];
const warnings=[];
const requireFile=relativePath=>{
  const absolutePath=path.join(root,relativePath);
  if(!fs.existsSync(absolutePath)){errors.push(`Missing required file: ${relativePath}`);return ''}
  return fs.readFileSync(absolutePath,'utf8');
};
const expect=(condition,message)=>{if(!condition)errors.push(message)};
const parseJSON=relativePath=>{
  try{return JSON.parse(requireFile(relativePath))}
  catch(error){errors.push(`${relativePath}: invalid JSON (${error.message})`);return null}
};

const designSystem=requireFile('assets/design-system.css');
const sharedCss=requireFile('game/_shared/game-page.css');
const layoutCss=requireFile('game/_shared/game-layout.css');
const sectionsCss=requireFile('game/_shared/game-sections.css');
const dialogCss=requireFile('game/_shared/game-dialog.css');
const overridesCss=requireFile('game/_shared/game-overrides.css');
const sharedShell=requireFile('game/_shared/game-shell.js');
const sharedLoader=requireFile('game/_shared/game-page.js');
const renderer=requireFile('game/_shared/game-page-v2.js');
const awardsImporter=requireFile('scripts/import-awards.mjs');
const homepage=requireFile('index.html');

for(const token of ['--ig-bg','--ig-surface','--ig-surface-2','--ig-text','--ig-muted','--ig-line','--ig-rating','--ig-accent','--ig-radius-md','--ig-container','--ig-font','--ig-display','--ig-game-display']){
  expect(designSystem.includes(token),`Design system is missing token ${token}`);
}
expect(!designSystem.includes('--ig-award'),'Decorative award color token is forbidden');
expect(homepage.includes('assets/design-system.css'),'Homepage must load assets/design-system.css');
expect(sharedCss.includes("@import url('../../assets/design-system.css')"),'Game CSS must import the canonical design system');
for(const importName of ['game-layout.css','game-sections.css','game-dialog.css','game-overrides.css'])expect(sharedCss.includes(importName),`game-page.css must import ${importName}`);
for(const contract of ['.game-hero','.hero-score-card','.hero-media','.game-tabs'])expect(layoutCss.includes(contract),`Game layout is missing ${contract}`);
for(const contract of ['.overview-grid','.featured-review','.media-feature-grid','.requirements-grid','.guide-grid','.award-source'])expect(sectionsCss.includes(contract),`Game sections are missing ${contract}`);
expect(dialogCss.includes('.rating-dialog'),'Rating dialog styles are missing');
expect(overridesCss.includes('[data-tab="sourcesTab"]'),'The internal sources tab must be hidden from the six-section public navigation');
expect(sharedShell.includes('game-page.js'),'game-shell.js must load game-page.js');
expect(sharedLoader.includes('game-page-v2.js'),'game-page.js must load game-page-v2.js');
for(const contract of ['function renderAwards(','function renderRequirements(','function renderReviews(','function renderMedia(','function bindRating(','../../data/game-content/','../../data/awards/'])expect(renderer.includes(contract),`Game renderer is missing ${contract}`);
for(const tab of ['overview','reviews','media','news','requirements','guides'])expect(renderer.includes(`data-tab=\"${tab}\"`),`Game renderer is missing tab ${tab}`);
for(const forbidden of ['data-tab="achievements"','data-tab="modes"','data-tab="awards"','Достижения</button>','Режимы игры</button>'])expect(!renderer.includes(forbidden),`Forbidden game-page section found: ${forbidden}`);
expect(renderer.includes("item?.name&&(item.source_url||item.url)"),'Awards must require a source URL before rendering');
expect(awardsImporter.includes('generated award artwork is forbidden'),'Awards importer must reject generated artwork');
expect(awardsImporter.includes('source_url are required'),'Awards importer must require a source URL');

const awardVisualFiles={designSystem,layoutCss,sectionsCss,dialogCss,overridesCss,renderer};
const forbiddenAwardVisuals=[/\bgold\b/i,/#ffd700/i,/#ffca05/i,/🏆/u,/🥇/u,/\btrophy\b/i,/\bmedal\b/i,/\blaurel\b/i];
for(const [name,content] of Object.entries(awardVisualFiles))for(const pattern of forbiddenAwardVisuals)expect(!pattern.test(content),`${name}: decorative award visual is forbidden (${pattern})`);

try{new Function(sharedShell);new Function(sharedLoader);new Function(renderer)}catch(error){errors.push(`Shared game JavaScript has a syntax error: ${error.message}`)}

const catalog=parseJSON('data/catalog-visible.json')||[];
const catalogSlugs=new Set(catalog.map(item=>item.slug));
const contentDirectory=path.join(root,'data/game-content');
const covered=new Set();
if(!fs.existsSync(contentDirectory))errors.push('Missing data/game-content directory');
else{
  for(const filename of fs.readdirSync(contentDirectory).filter(name=>name.endsWith('.json'))){
    const parsed=parseJSON(`data/game-content/${filename}`);
    expect(parsed?.schema_version===2,`data/game-content/${filename}: schema_version must be 2`);
    for(const [slug,game] of Object.entries(parsed?.games||{})){
      expect(!covered.has(slug),`Duplicate curated game record: ${slug}`);
      covered.add(slug);
      expect(catalogSlugs.has(slug),`data/game-content/${filename}: ${slug} is not present in catalog-visible.json`);
      expect(game?.identity?.slug===slug,`data/game-content/${filename}: ${slug} has a mismatched identity.slug`);
      expect(Boolean(game?.identity?.title),`data/game-content/${filename}: ${slug} is missing title`);
      expect(Boolean(game?.release?.date_text),`data/game-content/${filename}: ${slug} is missing release year/date`);
      expect(Array.isArray(game?.companies?.developers)&&game.companies.developers.length>0,`data/game-content/${filename}: ${slug} is missing developer`);
      expect(Boolean(game?.editorial?.short_description),`data/game-content/${filename}: ${slug} is missing description`);
      expect(Array.isArray(game?.editorial?.features)&&game.editorial.features.length>=4,`data/game-content/${filename}: ${slug} needs at least four features`);
      expect(Array.isArray(game?.classification?.genres)&&game.classification.genres.length>0,`data/game-content/${filename}: ${slug} is missing genres`);
      expect(Array.isArray(game?.classification?.platforms)&&game.classification.platforms.length>0,`data/game-content/${filename}: ${slug} is missing platforms`);
      expect(Array.isArray(game?.requirements?.platforms)&&game.requirements.platforms.length>0,`data/game-content/${filename}: ${slug} must expose platforms through requirements`);
      for(const award of game?.awards||[])expect(Boolean(award?.name&&(award.source_url||award.url)),`data/game-content/${filename}: ${slug} has an unsourced award`);
    }
  }
}
for(const item of catalog)expect(covered.has(item.slug),`Catalog game ${item.slug} has no curated game-content record`);
expect(covered.size===catalog.length,`Curated game coverage ${covered.size} does not match catalog size ${catalog.length}`);

const awardsDirectory=path.join(root,'data/awards');
if(fs.existsSync(awardsDirectory)){
  for(const filename of fs.readdirSync(awardsDirectory).filter(name=>name.endsWith('.json'))){
    const parsed=parseJSON(`data/awards/${filename}`);
    for(const award of parsed?.awards||[]){
      expect(Boolean(award?.name),`data/awards/${filename}: award is missing name`);
      expect(/^https?:\/\//i.test(String(award?.source_url||award?.url||'')),`data/awards/${filename}: award is missing a valid source URL`);
      const image=String(award?.image_url||award?.logo_url||'');
      expect(!image||/^https?:\/\//i.test(image),`data/awards/${filename}: image must be an original HTTP source asset`);
      expect(!award?.drawn_badge&&!award?.synthetic_icon&&!award?.generated_image,`data/awards/${filename}: drawn award assets are forbidden`);
    }
  }
}

const gameRoot=path.join(root,'game');
let checkedPages=0;
if(!fs.existsSync(gameRoot))errors.push('Missing game directory');
else{
  const directories=fs.readdirSync(gameRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name!=='_shared');
  for(const directory of directories){
    const relativePath=`game/${directory.name}/index.html`;
    const absolutePath=path.join(root,relativePath);
    if(!fs.existsSync(absolutePath)){warnings.push(`${relativePath}: page is missing`);continue}
    const html=fs.readFileSync(absolutePath,'utf8');
    checkedPages+=1;
    expect(html.includes('../_shared/game-page.css'),`${relativePath}: must load the shared game CSS`);
    expect(html.includes('../_shared/game-shell.js')||html.includes('../_shared/game-page.js'),`${relativePath}: must load the shared renderer`);
    expect(/data-slug=/.test(html),`${relativePath}: data-slug is required`);
    expect(/data-year=/.test(html),`${relativePath}: data-year is required`);
    expect(covered.has(directory.name),`${relativePath}: no curated game-content record for directory slug`);
    if(/<style(?:\s|>)/i.test(html))warnings.push(`${relativePath}: contains legacy inline CSS; the shared renderer replaces it at runtime`);
  }
}
expect(checkedPages>0,'No game pages were found');
expect(checkedPages===catalog.length,`Game page count ${checkedPages} does not match catalog size ${catalog.length}`);

if(warnings.length){console.warn(`Design-system warnings (${warnings.length}):`);for(const warning of warnings)console.warn(`- ${warning}`)}
if(errors.length){console.error(`Design-system check failed (${errors.length}):`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log(`Design-system check passed for ${checkedPages} game pages and ${covered.size} curated records.`);
