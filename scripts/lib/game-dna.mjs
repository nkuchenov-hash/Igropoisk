export const DNA_PROFILE_AXES = [
  'genres', 'subgenres', 'core_loop', 'combat_style', 'traversal', 'world_structure',
  'mission_structure', 'progression', 'perspective', 'player_agency', 'pacing',
  'narrative', 'setting', 'tone', 'multiplayer', 'mechanics',
];

export const DNA_CORE_AXES = [
  'core_loop', 'combat_style', 'traversal', 'world_structure',
  'mission_structure', 'progression', 'perspective',
];

export const DNA_STATUSES = new Set(['auto', 'researched', 'reviewed', 'locked']);

export function normalizeTag(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function normalizeTagList(value) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return [...new Set(list.map(normalizeTag).filter(Boolean))];
}

const textOf = (game) => [
  game?.identity?.title,
  game?.editorial?.short_description,
  game?.editorial?.integrated_description,
  ...(game?.editorial?.features || []),
  ...(game?.classification?.categories || []),
  ...(game?.classification?.genres || []),
].filter(Boolean).join(' ');

const KEYWORDS = {
  core_loop: {
    combat: ['combat', 'battle', 'fight', 'fighting', 'бой', 'сражен'],
    exploration: ['explore', 'exploration', 'discover', 'open world', 'исслед', 'открыт мир'],
    traversal: ['traversal', 'movement', 'web-swing', 'web swing', 'parkour', 'перемещ', 'паркур'],
    stealth: ['stealth', 'sneak', 'скрыт', 'стелс'],
    puzzle_solving: ['puzzle', 'головолом'],
    dialogue: ['dialogue', 'conversation', 'диалог'],
    survival: ['survival', 'hunger', 'thirst', 'выжив'],
    crafting: ['craft', 'crafting', 'крафт', 'создан предмет'],
    building: ['building', 'construction', 'base building', 'строител'],
    management: ['management', 'manage', 'управлен'],
    collecting: ['collect', 'collectible', 'собира', 'коллекц'],
    racing: ['racing', 'race', 'гонк'],
    sports: ['sports', 'football', 'soccer', 'basketball', 'хоккей', 'спорт'],
    strategy: ['strategy', 'strategic', 'стратег'],
    platforming: ['platforming', 'platformer', 'платформ'],
    social: ['social deduction', 'social simulation', 'социальн'],
  },
  combat_style: {
    melee: ['melee', 'close combat', 'ближн бой'],
    ranged: ['ranged', 'bow', 'archery', 'дальн бой', 'лук'],
    shooter: ['shooter', 'shooting', 'gunplay', 'fps', 'tps', 'стрель', 'шутер'],
    cover_based: ['cover-based', 'cover based', 'take cover', 'укрыти'],
    soulslike: ['soulslike', 'souls-like', 'souls like'],
    hack_and_slash: ['hack and slash', 'hack-and-slash', 'слэшер'],
    tactical: ['tactical combat', 'deep tactical', 'tactical battles', 'тактич'],
    turn_based: ['turn-based', 'turn based', 'пошаг'],
    real_time: ['real-time combat', 'real time combat', 'реальном времени'],
    stealth_combat: ['stealth combat', 'silent takedown', 'скрытн устран'],
    hero_abilities: ['superpower', 'super power', 'hero abilities', 'special abilities', 'суперспособ', 'особые способности'],
  },
  traversal: {
    parkour: ['parkour', 'free running', 'паркур'],
    web_swinging: ['web-swing', 'web swing', 'web swinging', 'паутин', 'swing through'],
    climbing: ['climb', 'climbing', 'карабк', 'скалолаз'],
    mounts: ['mount', 'horse', 'horses', 'лошад', 'верхом'],
    vehicles: ['vehicle', 'driving', 'car', 'motorcycle', 'машин', 'транспорт'],
    flight: ['flight', 'flying', 'fly freely', 'полет', 'летат'],
    gliding: ['glide', 'gliding', 'web wings', 'планир', 'крылья'],
    swimming: ['swim', 'swimming', 'плаван'],
    platforming: ['platforming', 'platformer', 'платформ'],
    fast_travel: ['fast travel', 'быстр перемещ'],
    on_foot: ['on foot', 'пешком'],
  },
  world_structure: {
    open_world: ['open world', 'открыт мир'],
    open_zone: ['open zone', 'open-zone', 'large zones', 'открыт зон'],
    sandbox: ['sandbox', 'песочниц'],
    hub: ['hub world', 'hub-based', 'hub based', 'хаб'],
    linear: ['linear', 'линей'],
    level_based: ['level-based', 'level based', 'levels', 'уровн'],
    mission_based: ['mission-based', 'mission based', 'missions', 'мисси'],
    roguelike_runs: ['roguelike', 'roguelite', 'runs', 'забег'],
  },
  mission_structure: {
    story_plus_side_content: ['side quest', 'side mission', 'side activities', 'побочн задан', 'побочн мисс'],
    main_story_linear: ['linear campaign', 'story campaign', 'линейн кампан'],
    mission_select: ['mission select', 'select missions', 'выбор мисси'],
    contracts: ['contract', 'bounty', 'заказ', 'контракт'],
    systemic_objectives: ['systemic objective', 'dynamic objective', 'процедурн задан'],
    levels: ['levels', 'stages', 'уровн'],
    runs: ['runs', 'забег'],
    sandbox_goals: ['sandbox goals', 'player-defined goals', 'свободн цел'],
  },
  progression: {
    skill_tree: ['skill tree', 'skill points', 'дерев навы', 'очки навык'],
    abilities: ['abilities', 'powers', 'способност'],
    gear_loot: ['loot', 'gear', 'добыч', 'экипиров'],
    stats_builds: ['builds', 'character build', 'stats', 'характеристик', 'билд'],
    equipment_upgrades: ['weapon upgrade', 'equipment upgrade', 'улучшен оруж', 'улучшен экип'],
    crafting: ['crafting', 'крафт'],
    base_upgrades: ['base upgrade', 'settlement upgrade', 'улучшен баз'],
    unlocks: ['unlock', 'разблокир'],
    cosmetic: ['cosmetic', 'скин', 'косметич'],
  },
  perspective: {
    first_person: ['first person', 'first-person', 'от первого'],
    third_person: ['third person', 'third-person', 'от третьего'],
    isometric: ['isometric', 'изометр'],
    top_down: ['top down', 'top-down', 'вид сверху'],
    side_view: ['side view', 'side-view', 'вид сбоку'],
    vr: ['virtual reality', ' vr ', 'виртуальн реальн'],
  },
  player_agency: {
    fixed_protagonist: ['play as ', 'protagonist', 'главн герой'],
    character_creation: ['character creation', 'create your character', 'создан персонаж'],
    dialogue_choices: ['dialogue choices', 'dialogue options', 'выбор в диалог'],
    branching_story: ['branching story', 'choices matter', 'choices shape', 'choices have consequences', 'your choices', 'every choice', 'all choices', 'multiple endings', 'ветвящ', 'несколько концов'],
    systemic_choices: ['systemic choices', 'emergent choices', 'системн выбор'],
    role_playing_builds: ['character builds', 'role-playing build', 'ролевая сборк'],
  },
  pacing: {
    fast_action: ['fast-paced', 'fast paced', 'high-speed action', 'динамичн', 'высок темп'],
    deliberate: ['deliberate', 'methodical', 'slow-paced', 'медленн темп', 'размеренн'],
    tactical: ['tactical', 'тактич'],
    relaxed: ['relaxing', 'cozy', 'laid-back', 'уютн', 'расслаб'],
  },
  narrative: {
    cinematic: ['cinematic', 'cutscene', 'кинематограф'],
    story_heavy: ['story-rich', 'story rich', 'narrative-driven', 'сюжетн', 'истори'],
    choice_driven: ['choices matter', 'choices shape', 'choices have consequences', 'your choices', 'every choice', 'all choices', 'branching', 'choice-driven', 'выбор', 'ветвящ'],
    emergent: ['emergent narrative', 'emergent story', 'процедурн истор'],
    environmental: ['environmental storytelling', 'повествован окруж'],
    minimal: ['minimal story', 'story-light', 'минимальн сюжет'],
  },
  setting: {
    modern: ['modern day', 'modern-day', 'современн'],
    historical: ['historical', 'историч'],
    fantasy: ['fantasy', 'dungeons & dragons', 'dungeons and dragons', 'elf', 'elves', 'dwarf', 'dwarves', 'sorcery', 'фэнтези'],
    dark_fantasy: ['dark fantasy', 'темн фэнтези'],
    science_fiction: ['science fiction', 'sci-fi', 'sci fi', 'научн фантаст'],
    cyberpunk: ['cyberpunk', 'киберпанк'],
    post_apocalyptic: ['post-apocalyptic', 'post apocalyptic', 'постапок'],
    superhero: ['superhero', 'super hero', 'супергеро'],
    western: ['western', 'дик запад', 'вестерн'],
    space: ['space', 'космос', 'космич'],
    medieval: ['medieval', 'средневек'],
  },
  tone: {
    heroic: ['heroic', 'героич'],
    dark: ['dark', 'grim', 'мрач'],
    serious: ['serious', 'dramatic', 'серьезн', 'драматич'],
    comedic: ['comedy', 'humor', 'funny', 'комед', 'юмор'],
    horror: ['horror', 'ужас', 'хоррор'],
    melancholic: ['melancholic', 'melancholy', 'меланхол'],
    whimsical: ['whimsical', 'причудлив'],
    hopeful: ['hopeful', 'надежд'],
    gritty: ['gritty', 'жестк', 'суров'],
  },
  multiplayer: {
    singleplayer: ['single-player', 'single player', 'singleplayer', 'одиночн'],
    coop: ['co-op', 'coop', 'cooperative', 'кооперат'],
    competitive: ['pvp', 'competitive', 'соревнов'],
    mmo: ['mmo', 'massively multiplayer', 'массов многопольз'],
    shared_world: ['shared world', 'shared-world', 'общ мир'],
    local_multiplayer: ['local multiplayer', 'couch co-op', 'split-screen', 'split screen', 'локальн мультиплеер'],
  },
  mechanics: {
    stealth: ['stealth', 'стелс'],
    crafting: ['crafting', 'крафт'],
    dialogue: ['dialogue', 'диалог'],
    puzzles: ['puzzle', 'головолом'],
    climbing: ['climbing', 'карабк'],
    parkour: ['parkour', 'паркур'],
    web_swinging: ['web-swing', 'web swing', 'паутин'],
    loot: ['loot', 'добыч'],
    skill_tree: ['skill tree', 'дерев навы'],
    cover_shooting: ['cover shooting', 'стрельб из укрыт'],
    parry: ['parry', 'парирован'],
    dodge: ['dodge', 'уклонен'],
    companions: ['companions', 'party-based', 'party based', 'gather your party', 'party of up to', 'спутник'],
    vehicles: ['vehicles', 'driving', 'транспорт'],
    base_building: ['base building', 'строител баз'],
  },
};

const GENRE_ALIASES = new Map(Object.entries({
  'экшен':'action','приключение':'adventure','приключения':'adventure','ролевая_игра':'rpg','ролевая':'rpg',
  'стратегия':'strategy','шутер':'shooter','симулятор':'simulation','выживание':'survival','гонки':'racing',
  'спорт':'sports','платформер':'platformer','открытый_мир':'open_world',
}));

const LEGACY_VALUE_ALIASES = {
  combat_style: { 'turn-based':'turn_based', 'turn_based':'turn_based', realtime:'real_time', 'real-time':'real_time', real_time:'real_time' },
  progression: { rpg_progression:'stats_builds', loot:'gear_loot' },
  setting: { scifi:'science_fiction', sci_fi:'science_fiction', postapoc:'post_apocalyptic' },
  core_loop: { action:'combat', adventure:'exploration', strategy:'strategy', survival:'survival', platformer:'platforming', shooter:'combat', simulation:'management' },
};

const STORE_FEATURE_FRAGMENTS = [
  'steam_', 'controller', 'adjustable_', 'camera_comfort', 'color_alternatives', 'volume_controls',
  'narrated_game_menus', 'timed_input', 'dualshock', 'dualsense', 'save_anytime', 'input_api',
  'stereo_sound', 'subtitle', 'surround_sound', 'steam_cloud', 'hdr_available', 'family_sharing',
  'achievements', 'trading_cards', 'remote_play', 'workshop', 'cloud_saves', 'captions_available',
];

const NON_SUBGENRE_TAGS = new Set([
  'single_player', 'multi_player', 'pvp', 'online_pvp', 'co_op', 'online_co_op', 'lan_co_op',
  'shared_split_screen_pvp', 'shared_split_screen_co_op', 'shared_split_screen',
  'cross_platform_multiplayer', 'local_multiplayer', 'online_multiplayer',
]);

const LEGACY_AXIS_MAP = {
  combat_style: 'combat',
  perspective: 'perspective',
  world_structure: 'world_structure',
  narrative: 'narrative',
  progression: 'progression',
  setting: 'setting',
  tone: 'tone',
  multiplayer: 'multiplayer',
  genres: 'genres',
  subgenres: 'subgenres',
  mechanics: 'mechanics',
};

function containsAny(text, terms) {
  const haystack = ` ${String(text || '').normalize('NFKD').toLowerCase()} `;
  return terms.some((term) => haystack.includes(String(term).normalize('NFKD').toLowerCase()));
}

function inferAxis(axis, text) {
  const matches = [];
  for (const [tag, terms] of Object.entries(KEYWORDS[axis] || {})) {
    if (containsAny(text, terms)) matches.push(tag);
  }
  return normalizeTagList(matches);
}

function mergeTags(...values) {
  return [...new Set(values.flatMap(normalizeTagList))];
}

function canonicalGenreList(values) {
  return normalizeTagList(values).map((tag) => GENRE_ALIASES.get(tag) || tag);
}

function canonicalLegacyValues(axis, values) {
  const aliases = LEGACY_VALUE_ALIASES[axis] || {};
  return normalizeTagList(values).map((tag) => aliases[tag] || tag);
}

function meaningfulLegacyTags(values) {
  return normalizeTagList(values).filter((tag) => !STORE_FEATURE_FRAGMENTS.some((fragment) => tag.includes(fragment)) && !NON_SUBGENRE_TAGS.has(tag));
}

export function normalizeDnaProfile(profile = {}) {
  const normalized = {};
  for (const axis of DNA_PROFILE_AXES) normalized[axis] = normalizeTagList(profile?.[axis]);
  normalized.franchise = normalizeTag(profile?.franchise || '');
  return normalized;
}

export function inferGameDna(game = {}) {
  const text = textOf(game);
  const legacy = game?.relations?.similarity_profile || {};
  const profile = {};

  profile.genres = mergeTags(canonicalGenreList(legacy.genres), canonicalGenreList(game?.classification?.genres));
  profile.subgenres = mergeTags(meaningfulLegacyTags(legacy.subgenres), game?.classification?.subgenres);

  for (const axis of DNA_PROFILE_AXES) {
    if (axis === 'genres' || axis === 'subgenres') continue;
    const legacyAxis = LEGACY_AXIS_MAP[axis];
    const legacyValues = axis === 'mechanics'
      ? meaningfulLegacyTags(legacyAxis ? legacy?.[legacyAxis] : [])
      : canonicalLegacyValues(axis, legacyAxis ? legacy?.[legacyAxis] : []);
    profile[axis] = mergeTags(legacyValues, inferAxis(axis, text));
  }
  profile.core_loop = mergeTags(profile.core_loop, canonicalLegacyValues('core_loop', legacy.gameplay_type));

  const genreSet = new Set(profile.genres);
  if (genreSet.has('action')) profile.core_loop = mergeTags(profile.core_loop, ['combat']);
  if (genreSet.has('adventure')) profile.core_loop = mergeTags(profile.core_loop, ['exploration']);
  if ([...genreSet].some((value) => value.includes('strategy'))) profile.core_loop = mergeTags(profile.core_loop, ['strategy']);
  if ([...genreSet].some((value) => value.includes('survival'))) profile.core_loop = mergeTags(profile.core_loop, ['survival']);
  if ([...genreSet].some((value) => value.includes('platform'))) profile.core_loop = mergeTags(profile.core_loop, ['platforming']);
  if ([...genreSet].some((value) => value.includes('racing'))) profile.core_loop = mergeTags(profile.core_loop, ['racing']);
  if ([...genreSet].some((value) => value.includes('sports'))) profile.core_loop = mergeTags(profile.core_loop, ['sports']);

  const isRpg = genreSet.has('rpg') || [...genreSet].some((value) => value.endsWith('_rpg') || value.includes('role_playing'));
  const isStrategy = genreSet.has('strategy') || [...genreSet].some((value) => value.includes('strategy'));
  const partyBased = containsAny(text, ['party-based', 'party based', 'gather your party', 'party of up to', 'party members', 'companions']);
  if (isRpg) profile.progression = mergeTags(profile.progression, ['stats_builds']);
  if (isRpg && partyBased) {
    profile.core_loop = mergeTags(profile.core_loop, ['combat']);
    profile.mechanics = mergeTags(profile.mechanics, ['companions']);
  }
  if (isRpg && isStrategy && partyBased) profile.combat_style = mergeTags(profile.combat_style, ['tactical']);

  const franchise = game?.relations?.franchise?.name || game?.classification?.franchise || game?.classification?.series || '';
  profile.franchise = normalizeTag(franchise);
  return normalizeDnaProfile(profile);
}

export function profileQuality(profile = {}) {
  const normalized = normalizeDnaProfile(profile);
  const populated = DNA_PROFILE_AXES.filter((axis) => normalized[axis].length > 0);
  const populatedCore = DNA_CORE_AXES.filter((axis) => normalized[axis].length > 0);
  return {
    populated_axes: populated.length,
    total_axes: DNA_PROFILE_AXES.length,
    core_axes: populatedCore.length,
    total_core_axes: DNA_CORE_AXES.length,
    populated,
    populated_core: populatedCore,
    ready_for_similarity: populated.length >= 6 && populatedCore.length >= 3,
    needs_enrichment: populated.length < 9 || populatedCore.length < 4,
  };
}

function stableEntity(entity) {
  return JSON.stringify({
    schema_version: entity.schema_version,
    game_id: entity.game_id,
    slug: entity.slug,
    title: entity.title,
    status: entity.status,
    locked_axes: entity.locked_axes,
    profile: entity.profile,
    provenance: entity.provenance,
    quality: entity.quality,
    evidence: entity.evidence,
    notes: entity.notes,
  });
}

export function materializeGameDna({ game = {}, catalogItem = {}, existing = null, now = new Date().toISOString() } = {}) {
  const inferred = inferGameDna(game);
  const status = DNA_STATUSES.has(existing?.status) ? existing.status : 'auto';
  const lockedAxes = [...new Set((existing?.locked_axes || []).filter((axis) => DNA_PROFILE_AXES.includes(axis)))];
  const previous = normalizeDnaProfile(existing?.profile || {});
  const profile = {};
  const provenance = {};

  for (const axis of DNA_PROFILE_AXES) {
    const preserveExisting = lockedAxes.includes(axis) || ['researched', 'reviewed', 'locked'].includes(status);
    profile[axis] = preserveExisting && previous[axis].length ? previous[axis] : inferred[axis];
    provenance[axis] = existing?.provenance?.[axis] || {
      mode: preserveExisting && previous[axis].length ? status : 'inferred',
      confidence: preserveExisting && previous[axis].length ? 0.9 : 0.55,
    };
  }
  profile.franchise = previous.franchise || inferred.franchise;

  const entity = {
    schema_version: 1,
    game_id: String(game?.identity?.game_id || catalogItem?.game_id || existing?.game_id || ''),
    slug: String(game?.identity?.slug || catalogItem?.slug || existing?.slug || ''),
    title: String(game?.identity?.title || catalogItem?.title || existing?.title || catalogItem?.slug || ''),
    status,
    revision: Number(existing?.revision || 0) + 1,
    created_at: existing?.created_at || now,
    updated_at: now,
    locked_axes: lockedAxes,
    profile,
    provenance,
    evidence: Array.isArray(existing?.evidence) ? existing.evidence : [],
    notes: String(existing?.notes || ''),
    quality: profileQuality(profile),
  };

  if (existing && stableEntity(entity) === stableEntity(existing)) return existing;
  return entity;
}

function setOf(value) {
  return new Set(normalizeTagList(value));
}

function overlap(leftValue, rightValue) {
  const left = setOf(leftValue);
  const right = setOf(rightValue);
  if (!left.size || !right.size) return { value: 0, compared: false };
  let hits = 0;
  for (const item of left) if (right.has(item)) hits += 1;
  return { value: hits / Math.max(left.size, right.size), compared: true };
}

export function compareGameDna(leftProfile = {}, rightProfile = {}, config = {}) {
  const left = normalizeDnaProfile(leftProfile);
  const right = normalizeDnaProfile(rightProfile);
  const weights = config.weights || {};
  const penalties = config.contradiction_penalties || {};
  let baseScore = 0;
  let penalty = 0;
  const reasons = [];
  let comparedCore = 0;
  let coreMatches = 0;

  for (const [axis, rawWeight] of Object.entries(weights)) {
    const weight = Number(rawWeight || 0);
    if (!weight) continue;
    const result = overlap(left[axis], right[axis]);
    if (DNA_CORE_AXES.includes(axis) && result.compared) {
      comparedCore += 1;
      if (result.value >= Number(config.core_match_overlap || 0.5)) coreMatches += 1;
    }
    const contribution = weight * result.value;
    baseScore += contribution;
    if (result.compared && result.value === 0 && Number(penalties[axis] || 0) > 0) penalty += Number(penalties[axis]);
    if (result.value >= Number(config.reason_overlap || 0.5) && contribution > 0) {
      reasons.push({ axis, overlap: Number(result.value.toFixed(3)), contribution: Number(contribution.toFixed(4)) });
    }
  }

  const minimumScore = Number(config.minimum_score || 0.42);
  const sameSeries = Boolean(left.franchise && right.franchise && left.franchise === right.franchise);
  let seriesBonus = 0;
  if (sameSeries && (!config.series_requires_other_similarity || baseScore >= minimumScore * 0.6)) {
    seriesBonus = Number(config.series_weight || 0.04);
    reasons.push({ axis: 'franchise', overlap: 1, contribution: seriesBonus });
  }

  const score = Math.max(0, Math.min(1, baseScore + seriesBonus - penalty));
  const enforceCore = comparedCore >= Number(config.minimum_core_axes_to_enforce || 2);
  const coreGate = !enforceCore || coreMatches >= Number(config.minimum_core_matches || 2);
  const qualified = score >= minimumScore && coreGate;

  return {
    score: Number(score.toFixed(4)),
    base_score: Number(baseScore.toFixed(4)),
    penalty: Number(penalty.toFixed(4)),
    series_bonus: Number(seriesBonus.toFixed(4)),
    compared_core_axes: comparedCore,
    core_matches: coreMatches,
    qualified,
    reasons: reasons.sort((a, b) => b.contribution - a.contribution || b.overlap - a.overlap).slice(0, 6),
  };
}
