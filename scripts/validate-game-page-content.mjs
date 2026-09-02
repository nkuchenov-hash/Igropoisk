#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// This validator is the semantic/content gate for the game-page module; media has a separate gate.
const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/validate-game-page-content.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const text=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const yearOf=v=>Number(String(v||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const cyrillicRatio=v=>{const s=text(v);const letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;if(!letters)return 0;return (s.match(/[А-Яа-яЁё]/g)||[]).length/letters};
const draft=read(`data/drafts/${slug}.json`,{});
const parser=read(`data/parser-output/${slug}.json`,{});
const errors=[];
const warnings=[];
const add=(cond,msg)=>{if(!cond)errors.push(msg)};

const title=text(draft.identity?.title);
const release=text(draft.release?.date||draft.release?.date_text);
const year=yearOf(release);
const short=text(draft.editorial?.short_description);
const integrated=text(draft.editorial?.integrated_description);
const campaign=text(draft.editorial?.campaign);
const features=(draft.editorial?.features||[]).map(text).filter(Boolean);
const developers=(draft.companies?.developers||[]).map(text).filter(Boolean);
const publishers=(draft.companies?.publishers||[]).map(text).filter(Boolean);
const genres=(draft.classification?.genres||[]).map(text).filter(Boolean);
const platforms=(draft.classification?.platforms||[]).map(text).filter(Boolean);
const requirements=text(draft.requirements?.pc?.minimum?.raw||draft.requirements?.pc?.recommended?.raw);

add(title.length>=2,'Нет нормального названия игры.');
add(year>=1970&&year<=new Date().getUTCFullYear()+10,`Не подтверждена нормальная дата релиза: ${release||'(пусто)'}.`);
add(developers.length>0,'Не указан разработчик.');
add(publishers.length>0,'Не указан издатель.');
add(genres.length>0,'Не указаны жанры.');
add(platforms.length>0,'Не указаны платформы.');
add(short.length>=90,`Краткое описание слишком бедное: ${short.length} символов.`);
add(cyrillicRatio(short)>=0.55,'Краткое описание должно быть полноценным русским текстом, а не сырым английским текстом магазина.');
add(integrated.length>=280,`Основное описание слишком короткое: ${integrated.length} символов.`);
add(cyrillicRatio(integrated)>=0.55,'Основное описание должно быть написано по-русски.');
add(campaign.length>=120,`Раздел о кампании/структуре прохождения слишком пустой: ${campaign.length} символов.`);
add(cyrillicRatio(campaign)>=0.55,'Раздел о кампании должен быть содержательным русским текстом.');
add(features.length>=4,`Недостаточно конкретных особенностей игры: ${features.length}/4.`);
for(const [i,item] of features.entries())add(item.length>=18,`Особенность #${i+1} слишком общая/короткая: ${item}`);
if(platforms.some(p=>/windows|pc/i.test(p)))add(requirements.length>=20,'Для PC-версии отсутствуют системные требования.');

const parserYear=yearOf(parser.release?.date||parser.release?.date_text);
if(parserYear&&year&&parserYear!==year)warnings.push(`Дата страницы ${year} отличается от даты текущего Steam-листинга ${parserYear}; это допустимо только если страница использует исходный релиз игры.`);
const generic=/(информация о которой собрана|проверяемых каталогов|official sources|verified catalogs)/i;
add(!generic.test(short),'Краткое описание является технической заглушкой, а не описанием игры.');
add(!generic.test(integrated),'Основное описание является технической заглушкой, а не описанием игры.');

const status=errors.length?'red-needs-revision':'green';
const report={schema_version:1,validator:'game-page-content-quality',game_slug:slug,checked_at:new Date().toISOString(),status,errors,warnings,metrics:{release_year:year,steam_listing_year:parserYear,short_description_chars:short.length,integrated_description_chars:integrated.length,campaign_chars:campaign.length,features:features.length,developers:developers.length,publishers:publishers.length,genres:genres.length,platforms:platforms.length,short_cyrillic_ratio:Number(cyrillicRatio(short).toFixed(3)),integrated_cyrillic_ratio:Number(cyrillicRatio(integrated).toFixed(3)),campaign_cyrillic_ratio:Number(cyrillicRatio(campaign).toFixed(3))}};
write(`data/quality-control/game-page-content-${slug}.json`,report);
console.log(JSON.stringify({slug,status,errors,warnings,metrics:report.metrics},null,2));
if(errors.length)process.exitCode=2;
