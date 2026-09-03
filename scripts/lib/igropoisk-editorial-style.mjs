const clean=value=>String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const list=value=>Array.isArray(value)?value.map(item=>clean(typeof item==='object'?(item.name||item.label||item.value||''):item)).filter(Boolean):[];
const uniq=value=>[...new Set(value.filter(Boolean))];

export const IGROPOISK_EDITORIAL_SYSTEM=`Ты редактор Игропоиска. Пиши сильным естественным современным русским языком, но только по переданному evidence corpus.

ДНК стиля:
- сначала объясни центральную игровую фантазию и то, что отличает именно эту игру; не начинай с сухого перечисления жанров, года или разработчика без причины;
- используй конкретные действия, системы и последствия решений вместо общих прилагательных;
- текст должен вызывать желание читать дальше, но не быть рекламой;
- не используй канцелярит, магазинный язык, машинные кальки, искусственный молодёжный сленг или мемы ради мемов;
- запрещённые типовые обороты: «игра предлагает игроку», «уникальный игровой опыт», «амбициозный проект, объединяющий элементы», «погрузитесь в», «вас ждёт незабываемое приключение», «широкий спектр возможностей», «динамичный геймплей» без конкретики;
- не добавляй факты из памяти модели и не достраивай типичные для жанра механики;
- store/platform capabilities не являются особенностями gameplay;
- красивый неподтверждённый факт хуже более узкого, но точного текста.

Audience adapter:
- страница должна говорить на языке аудитории конкретной игры, но только по подтверждённому INTERNAL AUDIENCE PROFILE;
- профиль меняет лексику, ритм, плотность терминов, резкость и акценты, но никогда не меняет факты;
- не выводи возраст/пол/демографию из жанра, визуального стиля или стереотипов;
- если профиль слабый или неизвестный, используй универсальный современный игровой регистр Игропоиска;
- семейные/доступные игры: яснее и образнее, без сюсюканья;
- взрослые/жестокие/провокационные/чёрно-комедийные игры: можно резче, суше и ироничнее, но без бессмысленного мата и попыток шокировать;
- хоррор: интерес через ситуацию, угрозу и правила выживания, без дешёвого кликбейта и спойлеров;
- стратегии/симуляторы/менеджмент: объясняй связи систем и последствия решений, точность терминов важнее украшений;
- нишевые/хардкорные игры: допустима ожидаемая жанровая терминология, но без снобизма.

Возвращай только валидный JSON без пояснений.`;

export function buildEditorialAudienceContext(draft={},parser={},corpus={}){
  const classification=draft?.classification||{};
  const explicitAge=clean(
    classification.age_rating||classification.content_rating||classification.esrb||classification.pegi||
    draft?.age_rating||draft?.content_rating||parser?.age_rating||parser?.content_rating||''
  );
  const tags=uniq([
    ...list(classification.tags),...list(parser?.tags),...list(corpus?.tags),...list(corpus?.audience_signals?.tags),
    ...list(classification.themes),...list(parser?.themes),...list(corpus?.themes)
  ]).slice(0,30);
  const perspectives=uniq([
    ...list(classification.player_perspectives),...list(parser?.player_perspectives),...list(corpus?.player_perspectives)
  ]).slice(0,12);
  const modes=uniq([
    ...list(classification.game_modes),...list(parser?.game_modes),...list(corpus?.game_modes)
  ]).slice(0,12);
  const official=[
    parser?.editorial?.short_description,
    parser?.editorial?.integrated_description,
    draft?.editorial?.short_description,
    draft?.editorial?.integrated_description
  ].map(clean).filter(Boolean).join(' ').slice(0,1200);
  const explicitAudience=corpus?.audience_profile||corpus?.audience_signals?.profile||draft?.internal?.audience_profile||null;
  const aggregateDemographics=corpus?.audience_signals?.aggregate_demographics||draft?.internal?.aggregate_demographics||null;
  const sourceSignals=Array.isArray(corpus?.audience_signals?.evidence)?corpus.audience_signals.evidence.slice(0,20):[];
  const hasStrongSignal=Boolean(explicitAudience||aggregateDemographics||tags.length>=5||sourceSignals.length);
  return {
    visibility:'internal_only',
    confidence:explicitAudience||aggregateDemographics?'high':hasStrongSignal?'medium':'low',
    explicit_audience_profile:explicitAudience,
    aggregate_demographics:aggregateDemographics,
    genres:list(classification.genres),
    tags,
    themes:uniq([...list(classification.themes),...list(parser?.themes),...list(corpus?.themes)]).slice(0,20),
    player_perspectives:perspectives,
    game_modes:modes,
    explicit_age_rating:explicitAge||null,
    tone_evidence:official||null,
    evidence:sourceSignals,
    rule:'Используй профиль только для выбора регистра, терминологии и акцентов. Не показывай профиль читателю и не придумывай демографию. Возрастной рейтинг — только дополнительный content signal, а не определение аудитории.'
  };
}

export function editorialSurfaceRule(surface){
  if(surface==='short_description')return 'TEASER: 1–2 предложения. Сразу покажи отличительную игровую фантазию/идею. Это high-impact текст: он должен цеплять конкретикой и говорить на естественном языке аудитории этой игры, а не рекламными эпитетами.';
  if(surface==='integrated_description')return 'ОБ ИГРЕ: сформируй цельную ментальную модель игры — что делает игрок, как устроен основной цикл/развитие, что отличает игру и почему это влияет на ощущение от неё. Терминология и ритм должны соответствовать audience profile. Не пересказывай store description по предложениям.';
  if(surface==='campaign')return 'PROGRESSION: описывай реальную структуру прохождения или развития. Не изобретай сюжетную кампанию. Если отдельной кампании нет, описывай подтверждённую структуру развития/сессий/забегов. Ясность важнее стилистической демонстративности.';
  if(surface==='features')return 'FEATURES: каждый пункт — конкретная система, решение, структура мира или взаимодействие механик. Используй ожидаемую аудиторией жанровую терминологию только когда она подтверждена. Никаких «уникальной атмосферы», «динамичного геймплея» и platform/store capabilities.';
  if(surface==='review')return 'REVIEW: отдельный большой редакционный материал. Нужны аргументированная позиция, синтез source corpus, причины достоинств/недостатков, связная композиция и конкретные примеры без выдумки. Это поверхность с максимальной допустимой адаптацией к языку аудитории игры.';
  return 'Пиши в каноническом стиле Игропоиска и адаптируй регистр только по подтверждённому INTERNAL AUDIENCE PROFILE.';
}
