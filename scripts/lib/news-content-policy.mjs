const titleRejectPatterns = [
  /^\s*(?:i|i'm|i’ve|i've|my|we|we're|we’ve|we've)\b/i,
  /\b(?:review|opinion|column|impressions?|hands[- ]on|preview)\b/i,
  /\bgame of the week\b/i,
  /\bmy favorite\b|\bstolen my .* heart\b|\btime i let go\b|\bi found solace\b/i,
  /\bneeds work\b|\bpun intended\b|\beating very well\b/i,
  /\bwhat console should you buy\b|\bwe break down\b/i,
  /\bhere (?:are|is) \d+ possibilities\b/i,
  /\bevery .{0,80} confirmed so far\b/i,
  /\bshare of the week\b|\bofficial .* podcast\b|\bpodcast episode\b/i,
  /\bhow to\b|\bwalkthrough\b|\bbeginner(?:'|’)?s guide\b|\bachievement guide\b/i,
  /\bwhere to (?:find|get|catch|buy|unlock|open)\b/i,
  /\bbest .{0,90}\bof all time\b|^\s*(?:the\s+)?\d+\s+best\b/i,
  /\b(?:best|top)\s+(?:new\s+)?games?\s+(?:releasing|coming|out)(?:\s+(?:in|this))?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\bgames?\s+releasing\s+(?:in\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:all|every) .{0,65}\b(?:locations?|collectibles?)\b/i,
  /\b(?:tips?|guide) to help you\b|\b(?:gameplay )?tips?\b|\btips? and tricks?\b/i,
  /\b(?:best|top) (?:skills?|abilities|builds?|weapons?|armor|classes)\b/i,
  /\bdebuts? on disney\+|\bcoming to disney\+/i,
  /\b(?:tv|television) (?:show|series)\b|\bmovie adaptation\b|\banime adaptation\b/i,
  /\blife[- ]sized statues?\b|\bcollectible statues?\b|\bfigurines?\b|\bmerch(?:andise)?\b/i,
  /\bcritical role\b.{0,80}\b(?:d&d|dungeons\s*&\s*dragons)\b/i,
  /\?/u,
  /\b(?:history|retrospective)\s+(?:of\s+)?(?:the\s+)?(?:series|franchise)\b/i,
  /(?:^|[^\p{L}\p{N}])истори\p{L}*\s+(?:серии|франшиз\p{L}*)/iu,
  /(?:^|[^\p{L}\p{N}])(?:лучшие|главные)\s+(?:новые\s+)?игр\p{L}*\s+(?:январ\p{L}*|феврал\p{L}*|март\p{L}*|апрел\p{L}*|ма[йя]|июн\p{L}*|июл\p{L}*|август\p{L}*|сентябр\p{L}*|октябр\p{L}*|ноябр\p{L}*|декабр\p{L}*)/iu,
  /(?:январ\p{L}*|феврал\p{L}*|март\p{L}*|апрел\p{L}*|ма[йя]|июн\p{L}*|июл\p{L}*|август\p{L}*|сентябр\p{L}*|октябр\p{L}*|ноябр\p{L}*|декабр\p{L}*).{0,45}(?:выходят|выйдут).{0,45}(?:лучшие|главные)\s+(?:новые\s+)?игр\p{L}*/iu,
  /(?:^|[^\p{L}\p{N}])(?:наконец[- ]?то|насмотрелись)(?:$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:возможно|вероятно),?\s+(?:сам\p{L}*\s+)?(?:худш\p{L}*|лучш\p{L}*)\s+(?:част\p{L}*|игр\p{L}*|релиз\p{L}*)/iu,
  /(?:^|[^\p{L}\p{N}])сам(?:ой|ая|ый|ое)\s+(?:эмоциональн\p{L}*|крут\p{L}*|лучш\p{L}*|худш\p{L}*)\s+(?:игр\p{L}*|част\p{L}*|проект\p{L}*)/iu,
  /(?:^|\b)(?:блогер|журналист).{0,90}(?:ж[её]стко\s+)?раскритиковал|\b(?:blogger|journalist)\b.{0,90}\b(?:slams?|critic(?:izes?|ised?|ized?))\b/iu,
  /(?:^|[^\p{L}\p{N}])фанат\p{L}*.{0,70}(?:травят|затрав\p{L}*|обрушил\p{L}*).{0,120}(?:разработчиц\p{L}*|разработчик\p{L}*|сценарист\p{L}*)/iu,
  /бесхарактерн\p{L}*\s+прихвост\p{L}*|бросает\s+вызов\s+жадности|а\s+не\s+то,?\s+что\s+вы\s+подумали/iu
];

const textRejectPatterns = [
  /\bsurvey\b|опрос/iu,
  /\bchance to win\b|\bgiveaway\b|розыгрыш|выигра[йт]/iu,
  /\bnewsletter\b|\bsubscribe\b|подписывайтесь|подписка/iu,
  /\bjob opening\b|we(?:'re| are) hiring|ваканси/iu,
  /\bsupport us\b|\bdonate\b|\bpatreon\b|поддержать издание/iu,
  /\bdeal of the day\b|\bbest deals\b|скидки дня|распродажа/iu,
  /\bgift guide\b|подарочный гид/iu,
  /\bletter from the editor\b|обращение редакции/iu,
  /обучающ\p{L}+\s+(?:ролик|видео)|tutorial\s+(?:video|guide)/iu,
  /огромн\p{L}+\s+внимани\p{L}*|вывести[^.!?]{0,50}на\s+новый\s+уровень/iu,
  /(?:его|её|их)(?:\s+и\s+[^.!?]{1,80})?\s+похитили\s+(?:ноутбук\p{L}*|оборудован\p{L}*|техник\p{L}*|устройств\p{L}*)/iu,
  /(?:виной\s+всему|обвинил\p{L}*).{0,90}(?:женщин\p{L}*|сценаристк\p{L}*|разработчиц\p{L}*)/iu,
  /(?:^|[.!?]\s+)(?:авторы|разработчики|создатели)\s+[^.!?]{0,55}\s+(?:показал(?:а)?|рассказал(?:а)?|объявил(?:а)?|представил(?:а)?|выпустил(?:а)?|опубликовал(?:а)?|подтвердил(?:а)?|раскрыл(?:а)?)(?:$|[^\p{L}])/iu,
  /(?:^|[.!?]\s+)(?:команда|студия|компания)\s+[^.!?]{0,55}\s+(?:показали|рассказали|объявили|представили|выпустили|опубликовали|подтвердили|раскрыли)(?:$|[^\p{L}])/iu,
  /\d+\.\s+\d+/u,
  /(?:^|\s)с\s+\d+\.\s*$/u,
  /\bмаркап\p{L}*|\$\d+(?:[.,]\d+)?\s+товар\p{L}*/iu
];

const nonGamingRejectPatterns = [
  /\b(?:netflix|hulu|prime video|streaming)\b.{0,140}\b(?:film|movie|thriller|series|show)\b|\b(?:film|movie|thriller|series|show)\b.{0,140}\b(?:netflix|hulu|prime video|streaming)\b/i,
  /(?:netflix|стриминг).{0,140}(?:фильм|сериал)|(?:фильм|сериал).{0,140}(?:netflix|стриминг)/iu,
  /\bdebian\b.{0,140}\b(?:generative ai|artificial intelligence|software development|developers vote)\b/i,
  /\b(?:bios|firmware|tpm|cve-\d{4}-\d+|motherboard)\b/i,
  /(?:bios|прошивк\p{L}*|tpm|cve-\d{4}-\d+).{0,140}(?:уязвимост\p{L}*|безопасност\p{L}*|amd|asus|ryzen)/iu
];

const urlRejectPattern = /(?:^|[\/_-])(?:guides?|walkthroughs?|tips|reviews?)(?:[\/_-]|$)/i;

const gamingSignals = [
  /\bgame\b|\bgames\b|\bgaming\b|игр[аыеу]|геймпле/iu,
  /release|launch|релиз|выходит|вышла|вышел/iu,
  /announce|анонс|представил|показал|трейлер/iu,
  /update|patch|hotfix|обновлен|патч/iu,
  /dlc|expansion|дополнени/iu,
  /developer|studio|publisher|разработчик|студи[яи]|издател/iu,
  /steam|valve|playstation|xbox|nintendo|switch|game pass|epic games/iu,
  /pc|console|консол/iu,
  /rpg|shooter|strategy|simulator|survival|horror|action|adventure|mmorpg/iu,
  /движок|unreal engine|unity|directx|vulkan|proton|dxvk|frostbite|steam deck/iu,
  /sales|copies sold|тираж|продаж/iu,
  /acquisition|layoffs|закрытие студии|увольнен|поглощени/iu,
  /beta|demo|early access|бета|демоверси|ранний доступ/iu,
  /esports|киберспорт/iu,
  /gta|grand theft auto|witcher|iron man|pokemon|pokémon|fable|wolverine/iu
];

export function newsContentRejectionReasons(input = {}) {
  const title = String(input.title || input.titleEn || '').replace(/\s+/g, ' ').trim();
  const summary = String(input.summary || input.summaryEn || '').replace(/\s+/g, ' ').trim();
  const url = String(input.url || input.primaryUrl || '').trim();
  const combined = `${title} ${summary}`.trim();
  const reasons = [];

  if (titleRejectPatterns.some(pattern => pattern.test(title))) reasons.push('feature/opinion/guide/cross-media title');
  if (textRejectPatterns.some(pattern => pattern.test(combined))) reasons.push('non-news editorial, malformed or promotional content');
  if (nonGamingRejectPatterns.some(pattern => pattern.test(combined))) reasons.push('non-gaming technology or entertainment content');
  if (urlRejectPattern.test(url)) reasons.push('guide/review URL');
  if (combined && !gamingSignals.some(pattern => pattern.test(combined))) reasons.push('no material gaming-news signal');

  return [...new Set(reasons)];
}

export function isLikelyNewsContent(input = {}) {
  return newsContentRejectionReasons(input).length === 0;
}
