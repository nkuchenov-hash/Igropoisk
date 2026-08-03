(()=>{
'use strict';
const page=document.querySelector('#newsPage');
if(!page)return;
const translations={
'9d853fc7ca507aa7':['Nintendo проведёт отдельный Direct по Fire Emblem: Fortune’s Weave','Презентация, посвящённая Fire Emblem: Fortune’s Weave, состоится менее чем через сутки.'],
'a532d4f7fe6ad720':['American Truck Simulator отправится в Северную Дакоту в новом DLC','Разработчики представили следующее дополнение для American Truck Simulator — Северную Дакоту.'],
'ebebbddfe03d57b7':['Рекламный AI-ролик Stellar Blade: Blood Rain вызвал резкую критику','Маркетинговый ролик Shift Up с генеративным видео вызвал негативную реакцию игроков и прессы.'],
'04ea84e004c544eb':['Слухи указывают на возможный ремейк Zelda: Ocarina of Time для Switch 2','Новые amiibo породили предположения о релизе ремейка в ноябре.'],
'0bde3f33049a303a':['Activision выпустила новый патч для Black Ops 2 после атак хакеров','Исправление для PlayStation должно устранить проблему, из-за которой взломанные лобби повреждали аккаунты игроков.'],
'216f49942255a96b':['RPG Star Trek Legends снимут с продажи и закроют в сентябре','Игру уже убрали с консолей; версии для ПК и мобильных устройств последуют за ними.'],
'fe60b58c31bb800d':['Final Fantasy 7 Revelation завершит основную историю без обязательного DLC','Директор проекта заявил, что базовая игра полностью завершит сюжет, а возможные дополнения будут отдельными историями.'],
'eac91c100a07e164':['Фанаты пытаются раскрыть следующего злодея Larian по скрытым символам','Исследователь мира Divinity переводит древние знаки из закулисных материалов студии.'],
'78f9bdde2d54b164':['В Pokémon Legends: Z-A стартует 15-й сезон','Новый сезон мультиплеера меняет правила и список доступных покемонов.'],
'4c8bae183fabdd3b':['Дизайнер Star Wars Unlimited показал недооценённую карту злодея','По словам разработчика, карта из The Acolyte может стать сильным выбором в текущей мете.'],
'566bb213975930ca':['Мод для Nier Replicant возвращает Отца Нира','Крупная модификация добавляет в ремастер главного героя из версии Nier Gestalt.'],
'dc257cc080257ab4':['Capcom перерабатывает систему Dragonsplague в Dragon’s Dogma 2','Студия хочет вернуть механике тот стратегический смысл, который был задуман изначально.'],
'71f8daaef6c512c0':['MSI представила первый 4K OLED-монитор с печатной панелью','Новая панель создана не Samsung и не LG и может стать важной проверкой технологии.'],
'3a75782d87df2eb0':['Mistfall Hunter сравнили с Dark Souls и Arc Raiders','Экшен-RPG сочетает soulslike-механику с эвакуационным форматом, но пока выглядит недостаточно оригинально.'],
'5488a486352342b4':['Одна из культовых способностей Марио появилась из-за бага','Сигэру Миямото решил оставить ошибку в игре, потому что она оказалась весёлой.'],
'ffc82503aca28206':['Dragon’s Dogma 2 получит сложный эндгейм-режим','Capcom готовит отдельный режим для опытных игроков.'],
'd17ab9061f7aa41c':['Square Enix ответила на обвинения в использовании AI в рекламе Kingdom Hearts','Компания отрицает, что применяла генеративный контент для продвижения будущей коллекции.'],
'56586a520dec78ba':['Marvel Tokon показывает высокий интерес ещё до релиза','Число регистраций на турниры указывает на сильный старт файтинга.'],
'88c0c19f0ac49799':['NVIDIA выпустила новые драйверы для Linux','Одновременно вышли стабильная версия 595.91.07 и новая функциональная ветка 610.57.04.']
};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tagsFor=item=>{
 const body=((translations[item.id]?.[0]||item.title||'')+' '+(translations[item.id]?.[1]||item.summary||'')).toLowerCase();
 const tags=[];
 if(/релиз|выйдет|ранн.*доступ|снимут с продажи/.test(body))tags.push('Релизы');
 if(/патч|обновлен|сезон|перерабатывает|драйвер/.test(body))tags.push('Обновления');
 if(/dlc|дополнен/.test(body))tags.push('DLC');
 if(/rpg|роле/.test(body))tags.push('RPG');
 if(/стратег|rts/.test(body))tags.push('Стратегии');
 if(/технолог|монитор|oled|драйвер|ai/.test(body))tags.push('Технологии');
 if(/студи|компания|издател|директор/.test(body))tags.push('Индустрия');
 return [...new Set(tags)].slice(0,4);
};
const normalize=item=>{
 const tr=translations[item.id];
 const title=tr?.[0]||item.titleRu||item.title||'';
 const summary=tr?.[1]||item.summaryRu||item.summary||'';
 if(!/[А-Яа-яЁё]/.test(title))return null;
 return {...item,titleRu:title,summaryRu:summary,url:item.primaryUrl||item.url,source:item.primarySource||item.source||item.publisher||''};
};
const card=item=>`<a class="card news-card" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(item.image)}" alt="${esc(item.titleRu)}" loading="lazy"><div class="card-body"><div class="date">${new Date(item.publishedAt).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})} · ${esc(item.source)}</div><div class="news-card__tags">${tagsFor(item).map(t=>`<span>${esc(t)}</span>`).join('')}</div><h3>${esc(item.titleRu)}</h3><p>${esc(item.summaryRu)}</p></div></a>`;
async function run(){
 const responses=await Promise.allSettled(['data/news.json','data/news-events.json','data/publisher-news.json'].map(async path=>{const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)return[];const p=await r.json();return Array.isArray(p)?p:(p.items||[])}));
 const map=new Map();
 responses.forEach(result=>{if(result.status!=='fulfilled')return;result.value.map(normalize).filter(Boolean).forEach(item=>{if(item.url&&!map.has(item.url))map.set(item.url,item)})});
 const items=[...map.values()].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
 let toolbar=document.querySelector('#newsFilters');
 if(!toolbar){toolbar=document.createElement('div');toolbar.id='newsFilters';toolbar.className='news-toolbar';page.before(toolbar)}
 const allTags=[...new Set(items.flatMap(tagsFor))];
 toolbar.innerHTML=`<div class="news-toolbar__top"><input type="search" placeholder="Найти игру, студию или тему"></div><div class="news-tag-filter"><button class="is-active" data-tag="">Все новости</button>${allTags.map(t=>`<button data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
 let active='';
 const render=()=>{const q=toolbar.querySelector('input').value.trim().toLowerCase();const filtered=items.filter(i=>(!active||tagsFor(i).includes(active))&&(!q||`${i.titleRu} ${i.summaryRu} ${tagsFor(i).join(' ')}`.toLowerCase().includes(q)));page.innerHTML=filtered.map(card).join('')||'<div class="empty">Новостей по выбранным параметрам нет.</div>'};
 toolbar.onclick=e=>{const b=e.target.closest('[data-tag]');if(!b)return;active=b.dataset.tag||'';toolbar.querySelectorAll('[data-tag]').forEach(x=>x.classList.toggle('is-active',x===b));render()};
 toolbar.querySelector('input').oninput=render;
 render();
}
run().catch(console.warn);
})();