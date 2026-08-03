import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const errors=[];
const read=relative=>{const absolute=path.join(root,relative);if(!fs.existsSync(absolute)){errors.push(`Missing ${relative}`);return''}return fs.readFileSync(absolute,'utf8')};
const expect=(condition,message)=>{if(!condition)errors.push(message)};
const json=relative=>{try{return JSON.parse(read(relative))}catch(error){errors.push(`${relative}: ${error.message}`);return null}};

const design=read('assets/design-system-game-v3.css');
const pageCss=read('game/_shared/game-page.css');
const v3Css=read('game/_shared/game-page-v3.css');
const shell=read('game/_shared/game-shell.js');
const loader=read('game/_shared/game-page.js');
const bootstrap=read('game/_shared/game-page-v3-bootstrap.js');
const rendererRaw=read('game/_shared/game-page-v3.js');
const renderer=rendererRaw.replace("['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт']]","['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт')] ]");

for(const token of ['--ig-user-score','--ig-glass-panel','--ig-card-wide'])expect(design.includes(token),`Missing design token ${token}`);
for(const component of ['.ig-scroll-rail','.ig-media-group','.ig-game-card-wide','.ig-review-feature','.ig-external-review-grid','.ig-admin-layout'])expect(design.includes(component),`Missing design-system component ${component}`);
expect(pageCss.includes('design-system-game-v3.css'),'Game page must import game v3 design-system components');
expect(pageCss.includes('game-page-v3.css'),'Game page must import v3 layout overrides');
expect(v3Css.includes('.hero-media-arrow'),'Hero media carousel controls are missing');
expect(v3Css.includes('.similar-row'),'Similar games v3 layout is missing');
expect(shell.includes('game-page.js?v='),'Game shell must bust the shared loader cache');
expect(loader.includes('game-page-v3-bootstrap.js'),'Shared loader must load v3 bootstrap');
expect(bootstrap.includes("source.replace"),'Bootstrap must normalize the committed v3 source before execution');
for(const contract of ['function renderHero(','function hydrateSimilarGames(','function renderReviews(','function renderMedia(','function bindRating(','data/ratings/','data/reviews/','data/news/'])expect(renderer.includes(contract),`Renderer is missing ${contract}`);
for(const text of ['Обзоры других изданий','Скриншоты','Арты и обложки','Оценка игроков'])expect(renderer.includes(text),`Renderer is missing UI contract: ${text}`);
expect(!renderer.includes('igropoisk-rating-${slug}'),'User ratings must not be stored in localStorage');
expect(renderer.includes('ratings_api_base'),'Renderer must use the ratings API configuration');
try{new Function(renderer);new Function(shell);new Function(loader);new Function(bootstrap)}catch(error){errors.push(`Game JavaScript syntax: ${error.message}`)}

const rating=json('data/ratings/the-witcher-3-wild-hunt.json');
expect(rating?.calculation?.score_10===9.3,'The Witcher 3 rating output must equal the transparent calculation');
expect((rating?.sources||[]).length>=3,'Rating requires at least three sources');
for(const source of rating?.sources||[])expect(/^https?:\/\//.test(source.url||''),`Rating source ${source.publication} is missing URL`);
const reviews=json('data/reviews/the-witcher-3-wild-hunt.json');
expect((reviews?.reviews||[]).every(item=>item.url),'Every external review card must have a URL');
expect(Boolean(reviews?.igropoisk_article?.url),'Игропоиск review must link to a separate article');
json('data/articles/the-witcher-3-wild-hunt.json');
read('article/the-witcher-3-wild-hunt/index.html');

for(const script of ['scripts/parse-game-data.mjs','scripts/parse-news.mjs','scripts/parse-ratings.mjs','scripts/synthesize-review.mjs'])read(script);
read('skills/review-synthesizer/SKILL.md');
const worker=read('backend/ratings-worker/src/index.js');
const schema=read('backend/ratings-worker/schema.sql');
expect(worker.includes("cf-connecting-ip"),'Ratings Worker must identify the Cloudflare client IP');
expect(worker.includes('HMAC'),'Ratings Worker must hash IP identifiers');
expect(schema.includes('PRIMARY KEY (game_slug, voter_hash)'),'Ratings schema must enforce one current vote per game and IP hash');
expect(schema.includes('rating_events'),'Ratings schema must keep append-only vote history');

if(errors.length){console.error(`Game v3 validation failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log('Game page v3, parsers, review article and ratings backend passed structural validation.');
