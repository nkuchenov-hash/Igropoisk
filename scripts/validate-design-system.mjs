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
const parseJSON=(relativePath)=>{
  try{return JSON.parse(requireFile(relativePath))}
  catch(error){errors.push(`${relativePath}: invalid JSON (${error.message})`);return null}
};

const designSystem=requireFile('assets/design-system.css');
const sharedCss=requireFile('game/_shared/game-page.css');
const layoutCss=requireFile('game/_shared/game-layout.css');
const sectionsCss=requireFile('game/_shared/game-sections.css');
const dialogCss=requireFile('game/_shared/game-dialog.css');
const sharedShell=requireFile('game/_shared/game-shell.js');
const sharedLoader=requireFile('game/_shared/game-page.js');
const renderer=requireFile('game/_shared/game-page-v2.js');
const homepage=requireFile('index.html');

for(const token of ['--ig-bg','--ig-surface','--ig-surface-2','--ig-text','--ig-muted','--ig-line','--ig-rating','--ig-accent','--ig-radius-md','--ig-container','--ig-font','--ig-display','--ig-game-display']){
  expect(designSystem.includes(token),`Design system is missing token ${token}`);
}
expect(homepage.includes('assets/design-system.css'),'Homepage must load assets/design-system.css');
expect(sharedCss.includes("@import url('../../assets/design-system.css')"),'Game CSS must import the canonical design system');
for(const importName of ['game-layout.css','game-sections.css','game-dialog.css'])expect(sharedCss.includes(importName),`game-page.css must import ${importName}`);
for(const contract of ['.game-hero','.hero-score-card','.hero-media','.game-tabs'])expect(layoutCss.includes(contract),`Game layout is missing ${contract}`);
for(const contract of ['.overview-grid','.featured-review','.media-feature-grid','.requirements-grid','.guide-grid','.award-source'])expect(sectionsCss.includes(contract),`Game sections are missing ${contract}`);
expect(dialogCss.includes('.rating-dialog'),'Rating dialog styles are missing');
expect(sharedShell.includes('game-page.js'),'game-shell.js must load game-page.js');
expect(sharedLoader.includes('game-page-v2.js'),'game-page.js must load game-page-v2.js');
for(const contract of ['function renderAwards(','function renderRequirements(','function renderReviews(','function renderMedia(','function bindRating(','../../data/game-content/','../../data/awards/'])expect(renderer.includes(contract),`Game renderer is missing ${contract}`);
for(const tab of ['overview','reviews','media','news','requirements','guides','sourcesTab'])expect(renderer.includes(`data-tab=\"${tab}\"`),`Game renderer is missing tab ${tab}`);
for(const forbidden of ['data-tab="achievements"','data-tab="modes"','data-tab="awards"','Достижения</button>','Режимы игры</button>'])expect(!renderer.includes(forbidden),`Forbidden game-page section found: ${forbidden}`);
expect(renderer.includes("item?.name&&(item.source_url||item.url)"),'Awards must require a source URL before rendering');

const awardVisualFiles={designSystem,layoutCss,sectionsCss,dialogCss,renderer};
const forbiddenAwardVisuals=[/\bgold\b/i,/#ffd700/i,/#ffca05/i,/🏆/u,/🥇/u,/\btrophy\b/i,/\bmedal\b/i];
for(const [name,content] of Object.entries(awardVisualFiles))for(const pattern of forbiddenAwardVisuals)expect(!pattern.test(content),`${name}: decorative award visual is forbidden (${pattern})`);

try{new Function(sharedShell);new Function(sharedLoader);new Function(renderer)}catch(error){errors.push(`Shared game JavaScript has a syntax error: ${error.message}`)}

const catalog=parseJSON('data/catalog-visible.json')||[];
const contentDirectory=path.join(root,'data/game-content');
const covered=new Set();
if(!fs.existsSync(contentDirectory))errors.push('Missing data/game-content directory');
else{
  for(const filename of fs.readdirSync(contentDirectory).filter(name=>name.endsWith('.json'))){
    const parsed=parseJSON(`data/game-content/${filename}`);
    for(const [slug,game] of Object.entries(parsed?.games||{})){
      covered.add(slug);
      expect(game?.identity?.slug===slug,`data/game-content/${filename}: ${slug} has a mismatched identity.slug`);
      expect(Boolean(game?.identity?.title),`data/game-content/${filename}: ${slug} is missing title`);
      expect(Boolean(game?.editorial?.short_description),`data/game-content/${filename}: ${slug} is missing description`);
      expect(Array.isArray(game?.classification?.genres),`data/game-content/${filename}: ${slug} is missing genres array`);
      for(const award of game?.awards||[])expect(Boolean(award?.name&&(award.source_url||award.url)),`data/game-content/${filename}: ${slug} has an unsourced award`);
    }
  }
}
for(const item of catalog)expect(covered.has(item.slug),`Catalog game ${item.slug} has no curated game-content record`);
expect(covered.size>=catalog.length,`Curated game coverage ${covered.size} is lower than catalog size ${catalog.length}`);

const awardsDirectory=path.join(root,'data/awards');
if(fs.existsSync(awardsDirectory)){
  for(const filename of fs.readdirSync(awardsDirectory).filter(name=>name.endsWith('.json'))){
    const parsed=parseJSON(`data/awards/${filename}`);
    for(const award of parsed?.awards||[]){
      expect(Boolean(award?.name),`data/awards/${filename}: award is missing name`);
      expect(Boolean(award?.source_url||award?.url),`data/awards/${filename}: award is missing source URL`);
      expect(!award?.drawn_badge&&!award?.synthetic_icon,`data/awards/${filename}: drawn award assets are forbidden`);
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
    if(/<style(?:\s|>)/i.test(html))warnings.push(`${relativePath}: contains legacy inline CSS`);
  }
}
expect(checkedPages>0,'No game pages were found');
expect(checkedPages>=catalog.length,`Only ${checkedPages} game pages exist for ${catalog.length} catalog entries`);

if(warnings.length){console.warn(`Design-system warnings (${warnings.length}):`);for(const warning of warnings)console.warn(`- ${warning}`)}
if(errors.length){console.error(`Design-system check failed (${errors.length}):`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log(`Design-system check passed for ${checkedPages} game pages and ${covered.size} curated records.`);
