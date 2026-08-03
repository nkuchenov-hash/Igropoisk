'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const chat = $('#wtpChat');
  if (!chat) return;

  const games = [
    {slug:'hades',title:'Hades',appid:1145360,rating:9.2,platforms:['PC','PlayStation','Xbox','Switch'],genres:['экшен','рогалик','rpg'],moods:['драйв','история'],session:'короткая',length:'средняя',modes:['один'],traits:['быстрый темп','яркая стилизация','повторные забеги'],avoid:['сложные бои'],warning:'Потребует привыкнуть к быстрым боям и повторным забегам.'},
    {slug:'the-witcher-3-wild-hunt',title:'The Witcher 3: Wild Hunt',appid:292030,rating:9.3,platforms:['PC','PlayStation','Xbox','Switch'],genres:['rpg','приключения'],moods:['история','исследование','атмосфера'],session:'длинная',length:'длинная',modes:['один'],traits:['сильные квесты','открытый мир','моральный выбор'],avoid:['открытый мир'],warning:'Это большая игра с открытым миром и десятками часов контента.'},
    {slug:'baldurs-gate-3',title:'Baldur’s Gate 3',appid:1086940,rating:9.5,platforms:['PC','PlayStation','Xbox'],genres:['rpg','стратегия'],moods:['история','подумать','исследование'],session:'длинная',length:'длинная',modes:['один','с друзьями'],traits:['тактика','реактивный мир','много диалогов'],avoid:['много текста','сложные бои'],warning:'Много диалогов и пошаговых тактических сражений.'},
    {slug:'red-dead-redemption-2',title:'Red Dead Redemption 2',appid:1174180,rating:9.4,platforms:['PC','PlayStation','Xbox'],genres:['приключения','экшен'],moods:['атмосфера','история','исследование'],session:'длинная',length:'длинная',modes:['один'],traits:['медленный темп','живой мир','кинематографичная история'],avoid:['открытый мир'],warning:'Медленный темп и очень большой открытый мир.'},
    {slug:'god-of-war',title:'God of War',appid:1593500,rating:9.2,platforms:['PC','PlayStation'],genres:['экшен','приключения'],moods:['история','драйв','атмосфера'],session:'средняя',length:'средняя',modes:['один'],traits:['линейное приключение','сильная постановка','зрелищные бои'],avoid:['сложные бои'],warning:'В игре много боёв, хотя сложность можно снизить.'},
    {slug:'forza-horizon-5',title:'Forza Horizon 5',appid:1551360,rating:8.8,platforms:['PC','Xbox'],genres:['гонки'],moods:['расслабиться','драйв'],session:'короткая',length:'любая',modes:['один','с друзьями','онлайн'],traits:['быстрый вход','свобода','много автомобилей'],avoid:['сюжет'],warning:'Сюжет здесь служебный; главное — вождение и события.'},
    {slug:'helldivers-2',title:'Helldivers 2',appid:553850,rating:8.7,platforms:['PC','PlayStation'],genres:['шутер','экшен'],moods:['драйв','хаос'],session:'средняя',length:'любая',modes:['с друзьями','онлайн'],traits:['кооператив','командная игра','короткие операции'],avoid:['сложные бои','онлайн'],warning:'Лучше всего раскрывается в кооперативе и требует постоянного соединения.'},
    {slug:'elden-ring',title:'Elden Ring',appid:1245620,rating:9.6,platforms:['PC','PlayStation','Xbox'],genres:['rpg','экшен'],moods:['исследование','атмосфера','испытание'],session:'длинная',length:'длинная',modes:['один','онлайн'],traits:['сложные бои','тайны мира','свобода исследования'],avoid:['сложные бои','открытый мир'],warning:'Высокая сложность и большой открытый мир — это основа игры.'},
    {slug:'cyberpunk-2077',title:'Cyberpunk 2077',appid:1091500,rating:8.8,platforms:['PC','PlayStation','Xbox'],genres:['rpg','экшен'],moods:['история','атмосфера','исследование'],session:'длинная',length:'длинная',modes:['один'],traits:['научная фантастика','открытый мир','сюжетные задания'],avoid:['открытый мир'],warning:'Большой город и множество побочных активностей могут отвлекать от сюжета.'},
    {slug:'hogwarts-legacy',title:'Hogwarts Legacy',appid:990080,rating:8.4,platforms:['PC','PlayStation','Xbox','Switch'],genres:['rpg','приключения'],moods:['расслабиться','исследование','атмосфера'],session:'средняя',length:'длинная',modes:['один'],traits:['знакомый мир','исследование школы','доступные бои'],avoid:['открытый мир'],warning:'Структура открытого мира местами повторяется.'},
    {slug:'disco-elysium',title:'Disco Elysium',appid:632470,rating:9.1,platforms:['PC','PlayStation','Xbox','Switch'],genres:['rpg','приключения'],moods:['история','подумать','атмосфера'],session:'средняя',length:'средняя',modes:['один'],traits:['детектив','почти без боёв','сложные диалоги'],avoid:['много текста'],warning:'Очень много текста; привычной боевой системы почти нет.'},
    {slug:'inside',title:'INSIDE',appid:304430,rating:8.9,platforms:['PC','PlayStation','Xbox','Switch'],genres:['приключения','головоломка'],moods:['атмосфера','подумать','на один вечер'],session:'короткая',length:'короткая',modes:['один'],traits:['линейная игра','без лишних слов','сильная атмосфера'],avoid:[],warning:'Мрачная и тревожная атмосфера может подойти не всем.'}
  ].map(g => ({...g,hero:`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_hero.jpg`}));

  const state = {step:0,platform:null,mood:null,time:null,mode:null,avoid:[],freeText:''};
  const questions = [
    {key:'mood',text:'Какого ощущения хочется от игры сейчас?',options:['Расслабиться','Погрузиться в историю','Исследовать мир','Подумать','Драйв и экшен','Что-то атмосферное']},
    {key:'time',text:'Сколько времени ты готов ей отдавать?',options:['На один вечер','Короткими сессиями','Несколько вечеров','Хочу надолго','Неважно']},
    {key:'platform',text:'На чём будешь играть?',options:['PC','PlayStation','Xbox','Switch','Неважно']},
    {key:'mode',text:'Один или с кем-то?',options:['Один','С друзьями','Онлайн','Неважно']},
    {key:'avoid',text:'Что точно не хочется?',options:['Сложные бои','Открытый мир','Много текста','Онлайн','Ничего из этого']}
  ];

  function addMessage(text, user = false) {
    const el = document.createElement('div');
    el.className = `wtp-message${user ? ' wtp-message--user' : ''}`;
    el.innerHTML = `<div class="wtp-message__bubble"><p>${escapeHtml(text)}</p></div>`;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  }

  function typing(next) {
    const el = document.createElement('div');
    el.className = 'wtp-message';
    el.innerHTML = '<div class="wtp-message__bubble"><span class="wtp-typing"><i></i><i></i><i></i></span></div>';
    chat.appendChild(el); chat.scrollTop = chat.scrollHeight;
    setTimeout(() => { el.remove(); next(); }, 330);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function normalize(value) { return value.toLowerCase().replace(/ё/g,'е'); }

  function infer(text) {
    const t = normalize(text);
    state.freeText += ` ${t}`;
    const sets = [
      ['platform', [['playstation','PlayStation'],['ps5','PlayStation'],['пк','PC'],['pc','PC'],['xbox','Xbox'],['switch','Switch']]],
      ['mood', [['расслаб','расслабиться'],['сюжет','история'],['истор','история'],['атмосфер','атмосфера'],['исслед','исследование'],['подум','подумать'],['драйв','драйв'],['экшен','драйв']]],
      ['time', [['вечер','на один вечер'],['коротк','короткая'],['надолго','длинная'],['долго','длинная']]],
      ['mode', [['друз','с друзьями'],['кооп','с друзьями'],['один','один'],['онлайн','онлайн']]]
    ];
    sets.forEach(([key, pairs]) => pairs.forEach(([needle,val]) => { if (t.includes(needle)) state[key] = val; }));
    ['сложные бои','открытый мир','много текста','онлайн'].forEach(item => { if (t.includes(item) || (item === 'много текста' && t.includes('без текста'))) state.avoid.push(item); });
    state.avoid = [...new Set(state.avoid)];
  }

  function mapAnswer(key, answer) {
    const a = normalize(answer);
    if (key === 'mood') state.mood = a.includes('расслаб') ? 'расслабиться' : a.includes('истор') ? 'история' : a.includes('исслед') ? 'исследование' : a.includes('подум') ? 'подумать' : a.includes('драйв') ? 'драйв' : 'атмосфера';
    if (key === 'time') state.time = a.includes('один вечер') ? 'на один вечер' : a.includes('коротк') ? 'короткая' : a.includes('несколько') ? 'средняя' : a.includes('надолго') ? 'длинная' : null;
    if (key === 'platform') state.platform = a.includes('неважно') ? null : answer;
    if (key === 'mode') state.mode = a.includes('неважно') ? null : a.includes('друз') ? 'с друзьями' : a.includes('онлайн') ? 'онлайн' : 'один';
    if (key === 'avoid' && !a.includes('ничего')) state.avoid.push(a);
    state.avoid = [...new Set(state.avoid)];
  }

  function renderSuggestions(options = []) {
    $('#wtpSuggestions').innerHTML = options.map(o => `<button class="wtp-suggestion" type="button">${escapeHtml(o)}</button>`).join('');
    $('#wtpSuggestions').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => submit(btn.textContent)));
  }

  function askCurrent() {
    if (state.step >= questions.length) return showResults();
    const q = questions[state.step];
    addMessage(q.text);
    renderSuggestions(q.options);
  }

  function submit(value) {
    const text = value.trim(); if (!text) return;
    addMessage(text, true); $('#wtpInput').value = ''; renderSuggestions([]);
    const q = questions[state.step];
    infer(text); if (q) mapAnswer(q.key, text);
    state.step += 1; renderProfile();
    if (state.step >= 3 && enoughContext()) typing(showResults); else typing(askCurrent);
  }

  function enoughContext() { return Boolean(state.mood && (state.time || state.platform || state.mode)); }

  function scoreGame(game) {
    let score = game.rating * 4;
    const reasons = [];
    if (state.platform) { if (game.platforms.includes(state.platform)) {score += 22; reasons.push(`есть на ${state.platform}`);} else score -= 100; }
    if (state.mood && game.moods.includes(state.mood)) { score += 24; reasons.push(`подходит под настроение «${state.mood}»`); }
    if (state.time) {
      if (state.time === 'на один вечер' && game.length === 'короткая') {score += 24; reasons.push('можно пройти за один-два вечера');}
      else if (state.time === game.session || state.time === game.length || game.length === 'любая') {score += 14; reasons.push('подходит по длительности');}
      else if (state.time === 'короткая' && game.session === 'короткая') score += 12;
    }
    if (state.mode) { if (game.modes.includes(state.mode)) {score += 18; reasons.push(state.mode === 'один' ? 'хорошо работает в одиночку' : `подходит для режима «${state.mode}»`);} else score -= 16; }
    state.avoid.forEach(a => { if (game.avoid.includes(a) || (a === 'онлайн' && game.modes.length === 1 && game.modes[0] === 'онлайн')) score -= 34; });
    const text = state.freeText;
    [...game.genres,...game.moods,...game.traits].forEach(token => { if (text.includes(normalize(token))) score += 5; });
    return {game,score,reasons};
  }

  function showResults() {
    renderSuggestions(['Слишком много текста','Хочу что-то короче','Только без открытого мира','Нужна игра с друзьями']);
    addMessage('Подбор готов. Я поставил выше игры, которые лучше совпадают с твоими ответами. Можешь уточнить пожелание прямо в чате — список пересчитается.');
    const ranked = games.map(scoreGame).sort((a,b) => b.score-a.score).filter(x => x.score > 0).slice(0,6);
    $('#wtpResults').innerHTML = ranked.map((item,index) => {
      const g = item.game;
      const reason = item.reasons.slice(0,2).join(' и ') || `сильная игра в жанре ${g.genres.slice(0,2).join(', ')}`;
      return `<article class="wtp-result"><div class="wtp-result__media"><img src="${g.hero}" alt="${escapeHtml(g.title)}" loading="lazy"><span class="wtp-result__rank">${index+1}</span></div><div class="wtp-result__body"><div class="wtp-result__meta"><span class="ig-pill">Игропоиск ${g.rating.toFixed(1)}</span><span class="ig-pill">${escapeHtml(g.platforms.slice(0,3).join(' · '))}</span></div><h3>${escapeHtml(g.title)}</h3><p class="wtp-result__reason">Почему подходит: ${escapeHtml(reason)}.</p><p class="wtp-result__warning"><b>Учти:</b> ${escapeHtml(g.warning)}</p><div class="wtp-result__actions"><button class="ig-button" data-game="${g.slug}">Подробнее</button><button class="ig-button wtp-dismiss" data-slug="${g.slug}">Не подходит</button></div></div></article>`;
    }).join('');
    $('#wtpResultsSection').hidden = false;
    $('#wtpResultsSection').scrollIntoView({behavior:'smooth',block:'start'});
    $('#wtpResults').querySelectorAll('.wtp-dismiss').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); games.splice(games.findIndex(g => g.slug === btn.dataset.slug),1); showResults(); }));
  }

  function renderProfile() {
    const values = [['Настроение',state.mood],['Время',state.time],['Платформа',state.platform],['Режим',state.mode],['Исключить',state.avoid.join(', ')]] .filter(([,v]) => v);
    $('#wtpProfile').innerHTML = values.length ? values.map(([k,v]) => `<span class="wtp-profile__item"><b>${k}</b>${escapeHtml(v)}</span>`).join('') : '<div class="wtp-profile__empty">Пока ничего не выбрано</div>';
  }

  function reset() {
    Object.assign(state,{step:0,platform:null,mood:null,time:null,mode:null,avoid:[],freeText:''});
    chat.innerHTML=''; $('#wtpResultsSection').hidden=true; renderProfile();
    addMessage('Расскажи, во что хочется поиграть. Можно написать своими словами или отвечать на короткие вопросы.');
    renderSuggestions(['Помоги выбрать','Хочу игру на один вечер','Что-то атмосферное','Поиграть с друзьями']);
  }

  $('#wtpForm').addEventListener('submit', e => {e.preventDefault();submit($('#wtpInput').value);});
  $('#wtpInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) {e.preventDefault(); $('#wtpForm').requestSubmit();} });
  $('#wtpInput').addEventListener('input', e => {e.target.style.height='auto';e.target.style.height=`${Math.min(e.target.scrollHeight,132)}px`;});
  $('#wtpReset').addEventListener('click', reset);
  $('#wtpRefine').addEventListener('click', () => { $('#wtpInput').focus(); chat.scrollIntoView({behavior:'smooth',block:'center'}); });
  reset();
})();
