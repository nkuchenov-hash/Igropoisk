import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const fail=message=>{throw new Error(message)};
const words=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const unique=list=>new Set(list).size;

for(const file of [
  'config/parsers/review-synthesis.json',
  'data/drafts/mafia.json',
  'data/reviews/mafia.json',
  'data/research/mafia-source-matrix.json',
  'data/ratings/mafia.json',
  'data/articles/mafia.json'
])read(file);

const config=read('config/parsers/review-synthesis.json');
const gate=config.publication_gate||{};
const requiredSources=Number(gate.editorial_reviews_required||20);
const minimumWords=Number(gate.minimum_article_words||2000);
const minimumSections=Number(gate.minimum_sections||8);
const minimumScreenshots=Number(gate.verified_screenshots_required||6);

const draft=read('data/drafts/mafia.json');
if(draft.identity?.title!=='Mafia: The City of Lost Heaven')fail('Mafia identity must target the original title');
if(Number(draft.identity?.release_year)!==2002)fail('Mafia identity must target the 2002 release');
if(!(draft.identity?.excluded_titles||[]).some(title=>/Definitive Edition/i.test(title)))fail('Remake exclusion is missing');
const verifiedShots=draft.media?.screenshots||[];
if(unique(verifiedShots)<minimumScreenshots)fail(`Mafia media gate failed: ${unique(verifiedShots)}/${minimumScreenshots}`);

const reviews=read('data/reviews/mafia.json');
if((reviews.reviews||[]).length<requiredSources)fail(`Mafia source gate failed: ${(reviews.reviews||[]).length}/${requiredSources}`);
if(unique((reviews.reviews||[]).map(item=>String(item.publication||item.source).toLowerCase()))<requiredSources)fail('Mafia review publications are not independent');
if(!reviews.igropoisk_article?.url)fail('Mafia game-page article link is missing');

const research=read('data/research/mafia-source-matrix.json');
if(research.coverage?.passed!==true)fail('Mafia research matrix is not passed');
if(Number(research.coverage?.contemporary||0)<12)fail('Historical contemporary-source minimum is not met');

const rating=read('data/ratings/mafia.json');
if(Number(rating.calculation?.score_10)!==9.2)fail('Mafia calculated rating must be 9.2');
if(Number(rating.calculation?.independent_scores||0)<3)fail('Mafia rating has too few independent scores');

const article=read('data/articles/mafia.json');
const articleWords=words(article.lead)+(article.sections||[]).reduce((sum,section)=>sum+(section.paragraphs||[]).reduce((subtotal,p)=>subtotal+words(p),0),0)+words(article.verdict?.summary);
if(article.publication_status!=='published')fail('Mafia article is not published');
if((article.sources||[]).length<requiredSources)fail('Mafia article source list is incomplete');
if((article.sections||[]).length<minimumSections)fail(`Mafia section gate failed: ${(article.sections||[]).length}/${minimumSections}`);
if(articleWords<minimumWords)fail(`Mafia word gate failed: ${articleWords}/${minimumWords}`);
const articleImages=(article.sections||[]).map(section=>section.image?.url).filter(Boolean);
if(unique(articleImages)<minimumScreenshots)fail(`Mafia image gate failed: ${unique(articleImages)}/${minimumScreenshots}`);
for(const section of article.sections||[]){
  if(section.image&&!verifiedShots.includes(section.image.url))fail(`Unverified image in section ${section.id}`);
}
const combat=(article.sections||[]).find(section=>section.id==='combat');
if(!combat?.image?.url)fail('Combat section requires an image');
if(!/2149075-0002/.test(combat.image.url))fail('Combat section must use the verified combat screenshot');

console.log(JSON.stringify({status:'passed',game:'mafia',sources:(article.sources||[]).length,sections:(article.sections||[]).length,words:articleWords,images:unique(articleImages),score:rating.calculation.score_10},null,2));
