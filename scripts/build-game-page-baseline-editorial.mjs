#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page-baseline-editorial.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const uniq=a=>[...new Set((a||[]).map(clean).filter(Boolean))];
const draft=read(`data/drafts/${slug}.json`,{}),parser=read(`data/parser-output/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const title=clean(draft.identity.title),developers=uniq(draft.companies?.developers),genres=uniq(draft.classification?.genres),categories=uniq(draft.classification?.categories),raw=clean(parser.editorial?.short_description||draft.editorial?.short_description).toLowerCase();
const developer=developers[0]||'неуказанного разработчика',genre=genres[0]||'игра';
const has=rx=>rx.test(raw);
const firstPerson=has(/first[- ]person|от первого лица/),thirdPerson=has(/third[- ]person|от третьего лица/),fantasy=has(/fantasy|фэнтез/),war=has(/\bwar\b|войн/),magic=has(/magic|spell|маг/),openWorld=has(/open world|open-world|открыт.*мир/),single=categories.some(x=>/single.?player/i.test(x))||has(/single.?player/),multi=categories.some(x=>/multi.?player/i.test(x))||has(/multi.?player/),rpg=genres.some(x=>/rpg|role.?playing/i.test(x))||has(/role.?playing|\brpg\b/),strategy=genres.some(x=>/strategy/i.test(x)),action=genres.some(x=>/action/i.test(x));
const perspective=firstPerson?'с видом от первого лица':thirdPerson?'с видом от третьего лица':'';
const genreRu=rpg?'ролевая игра':strategy?'стратегия':action?'экшен':`${genre.toLowerCase()}-игра`;
const worldPrep=fantasy?'в фэнтезийном мире':'в игровом мире',worldGen=fantasy?'фэнтезийного мира':'игрового мира',worldAcc=fantasy?'фэнтезийный мир':'игровой мир';
const mode=single&&!multi?'одиночное прохождение':single&&multi?'одиночный и многопользовательский режимы':multi?'многопользовательский режим':'основное прохождение';

const short=`${title} — ${genreRu} от ${developer}${perspective?` ${perspective}`:''}. Игра предлагает ${mode}, исследование ${worldGen} и развитие игрового персонажа${magic?' с использованием магических возможностей':''}.`;
const detail=[`${title} построена как ${genreRu}${perspective?` ${perspective}`:''}; разработчик — ${developer}.`,single?'Основной режим рассчитан на одиночное прохождение: игрок исследует локации, взаимодействует с окружением и развивает персонажа.':'Структура игры определяется заявленными режимами и набором механик, подтверждёнными официальной страницей.',fantasy?'Действие разворачивается в фэнтезийном мире, что определяет окружение, противников и общий характер приключения.':'Окружение и структура мира описываются по официальным данным игры.',magic?'В официальном описании отдельно отмечены магические элементы, поэтому они учитываются как часть доступных игроку возможностей.':'Ключевые механики здесь выводятся только из подтверждённых жанров, категорий и официального описания.',war?'Официальное описание указывает на крупный конфликт и войну как важную часть исходной ситуации мира.':'Неподтверждённые сюжетные детали в описание не добавляются.'].join(' ');
const campaign=single?`В ${title} предусмотрено одиночное прохождение. Игрок последовательно осваивает ${worldAcc}, исследует доступные локации и продвигается через основной игровой контент, используя ролевые механики и развитие персонажа${war?'; исходная ситуация мира связана с крупным конфликтом':''}. Описание не добавляет сюжетных деталей, которых нет в проверенных исходных данных.`:`Для ${title} структура прохождения описывается через подтверждённые режимы игры. Страница фиксирует доступные форматы, основные механики и порядок взаимодействия с игровым миром без выдуманных сюжетных деталей.`;
const featureCandidates=[];
if(rpg)featureCandidates.push('Ролевая структура с развитием персонажа и набором характеристик, определяющих стиль прохождения.');
if(firstPerson)featureCandidates.push('Вид от первого лица, через который построены исследование мира и основное взаимодействие с окружением.');
if(single)featureCandidates.push('Полноценный одиночный режим, рассчитанный на последовательное прохождение основного игрового контента.');
if(fantasy)featureCandidates.push('Фэнтезийное окружение определяет мир, атмосферу и характер встречающихся в ходе прохождения угроз.');
if(magic)featureCandidates.push('Магические возможности входят в подтверждённый набор игровых механик и дополняют развитие персонажа.');
if(openWorld)featureCandidates.push('Открытая структура мира позволяет свободнее выбирать направления исследования и порядок части активностей.');
if(war)featureCandidates.push('Крупный конфликт является частью исходной ситуации мира и задаёт контекст путешествия игрока.');
if(featureCandidates.length<4&&genres.length)featureCandidates.push(`Основные механики соответствуют жанровой классификации «${genres.join(', ')}» и не подменяются магазинными тегами.`);
if(featureCandidates.length<4)featureCandidates.push('Структура прохождения описывается по подтверждённым режимам и официальным характеристикам конкретной игры.');
if(featureCandidates.length<4)featureCandidates.push('На странице игровые особенности отделены от технических параметров, издательской информации и рекламных формулировок.');
if(featureCandidates.length<4)featureCandidates.push('Описание не приписывает игре механики, режимы или сюжетные свойства, которых нет в проверенных исходных данных.');

const current=draft.editorial||{};
const mostlyRussian=v=>{const s=clean(v),letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;return letters?((s.match(/[А-Яа-яЁё]/g)||[]).length/letters)>=0.55:false};
const weak=(v,n)=>clean(v).length<n||!mostlyRussian(v);
draft.editorial={...current,short_description:weak(current.short_description,90)?short:current.short_description,integrated_description:weak(current.integrated_description,280)?detail:current.integrated_description,campaign:weak(current.campaign,120)?campaign:current.campaign,features:(current.features||[]).length>=4&&(current.features||[]).every(x=>clean(x).length>=18&&mostlyRussian(x))?current.features:featureCandidates.slice(0,8)};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
console.log(JSON.stringify({slug,status:'completed',short:clean(draft.editorial.short_description).length,integrated:clean(draft.editorial.integrated_description).length,campaign:clean(draft.editorial.campaign).length,features:draft.editorial.features.length,signals:{firstPerson,fantasy,war,magic,single,multi,rpg}},null,2));
