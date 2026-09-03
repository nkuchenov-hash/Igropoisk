# Игропоиск — Editorial Audience Profile

**Status:** CANONICAL / INTERNAL
**Visibility:** NEVER rendered as a public game-page block by default.

## Purpose

Игропоиск должен говорить с читателем на языке конкретной игры. Для этого перед генерацией редакционного текста строится внутренний `audience_profile` — не рекламный таргетинг и не ярлык пользователя, а профиль того, какой язык, плотность терминов, ритм и акценты естественны для аудитории данной игры.

`audience_profile` используется только редакционным генератором и quality gates. Он не должен автоматически попадать в публичный JSON страницы, UI, SEO-текст или карточки.

## Core rule

Возрастной рейтинг сам по себе НЕ определяет аудиторию и стиль. ESRB/PEGI/content descriptors — только один сигнал о допустимом содержании и тематике.

Главные вопросы профиля:

- насколько аудитория знакома с жанром и его терминологией;
- что обычно является главным appeal этой игры: mastery, exploration, creation, story, competition, systems, social play, comfort, shock/black comedy и т. п.;
- какой регистр естественен: playful, warm, neutral, technical, dark, dry, ironic, abrasive;
- сколько жанрового жаргона читатель ожидает;
- насколько допустимы резкость, ирония и чёрный юмор;
- насколько важно избегать спойлеров;
- что аудитория считает существенной конкретикой именно для этого типа игры.

## Evidence priority

Профиль строится только из доступных подтверждённых сигналов. По убыванию ценности:

1. **Explicit aggregate audience data** — реальные агрегированные данные об аудитории, если они доступны из лицензированного/разрешённого источника.
2. **Weighted community/store tags** — жанр, subgenre, themes, moods, mechanics, visual style, competitive/co-op/relaxing/hardcore и другие устойчивые теги.
3. **Professional review corpus** — повторяющиеся ожидания, язык жанра, причины похвалы/критики и особенности, которые критики считают центральными.
4. **Game metadata** — genres, themes, player perspectives, modes, franchise context, similar-game cluster.
5. **Official store/editorial copy** — как сама игра позиционирует фантазию и ключевые действия.
6. **Age ratings/content descriptors** — только как подтверждённый сигнал зрелости/тематики, а не как доказательство реального возраста игроков.

Если сильных сигналов нет, профиль должен иметь низкую confidence и использовать нейтральный регистр Игропоиска.

## Never infer demographics from stereotypes

Запрещено делать выводы вроде:

- «стратегия → мужчины 30+»;
- «cute graphics → дети»;
- «Nintendo → семейная аудитория»;
- «Postal → подростки».

Возраст, пол и другие демографические характеристики допускаются в профиле только если они пришли как **агрегированные данные из явного источника**. Они не должны выводиться моделью из жанра, визуального стиля или текста обзоров.

## Internal schema

Рекомендуемая внутренняя форма:

```json
{
  "schema_version": 1,
  "game_slug": "...",
  "visibility": "internal_only",
  "confidence": "high|medium|low",
  "reader_familiarity": "broad|genre_literate|hardcore|mixed|unknown",
  "jargon_level": "low|medium|high",
  "register": ["playful", "warm", "neutral", "technical", "dark", "dry", "ironic", "abrasive"],
  "core_appeals": ["creation", "mastery", "exploration", "story", "competition", "systems", "social", "comfort", "black_comedy"],
  "spoiler_sensitivity": "low|medium|high|unknown",
  "content_context": [],
  "aggregate_demographics": null,
  "evidence": []
}
```

Fields may remain `unknown`/empty. Missing data is preferable to invented certainty.

## Editorial adaptation

The page does not change facts for different audiences. It changes **how those facts are expressed**.

Examples:

### Family / accessible creation game

Use clearer, more visual language; foreground discovery, creation and experimentation. Do not infantilize the reader.

### Hardcore strategy / simulation

Use expected genre terms and explain system interactions. Do not replace meaningful concepts with generic simplifications.

### Postal-like black comedy / provocation

The copy may be drier, sharper and more ironic because that register matches the work and its audience. Do not sterilize the game into corporate prose, but also do not turn Игропоиск into an edgelord imitation of the game.

### Cozy game

Foreground routine, comfort, exploration, collection or relationships if those are evidence-backed appeals. Avoid hyperactive marketing language.

### Competitive game

Foreground mastery, decisions, match structure, team/solo dynamics and skill expression when supported. Avoid vague words like “dynamic”.

## Surface-specific use

The same audience profile can influence multiple editorial surfaces differently:

- `short_description`: strongest immediate alignment with audience language;
- `integrated_description / Об игре`: enough genre vocabulary to feel native to the audience while remaining readable to newcomers;
- `campaign/progression`: clarity first;
- homepage / Popular / Top cards: high-impact, concise, audience-aware teaser;
- review: strongest adaptation because the reader is already engaged and can tolerate deeper terminology/context.

## Independence from model

The audience profile is an Игропоиск asset, not an AI-model feature. GigaChat, Gemini, GLM, GPT-OSS, Qwen or any future provider receives the same internal profile.

Changing the model must not change the intended audience voice.

## Failure behavior

- Missing audience data must never block page publication.
- If profile confidence is low, fall back to canonical neutral Игропоиск voice.
- Audience-profile generation failure must not destroy or invalidate an already published canonical page.
- No model may fabricate demographic certainty to make the text “more targeted”.