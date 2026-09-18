# Игропоиск — финальный результат теста моделей

Обновлено: 2026-09-18. Повторные gap-only прогоны полностью завершены 2026-09-09 и слиты в публичную базу результатов.

## Финальное решение

**Page Model: Qwen 3.6 27B.**

Одна Qwen 3.6 27B делает весь Page Editorial Bundle конкретной игры: Subtitle + Description + Features. После повторного прогона она закрыла последнюю проблемную Page-клетку (Wolfenstein 3D) и показала наиболее подходящий баланс полного Page-контракта, редакционного русского и доступности через прямой Groq route. Page всё равно обязан проходить claim/evidence audit: структурный pass сам по себе не гарантирует отсутствие выдуманных деталей.

**Review Model: GigaChat 3 Ultra.**

Review — отдельный независимый модуль. GigaChat не провалил Review: его подтверждённые полноразмерные обзоры Mafia и Spore прошли long-form structural contract. Повторный gap-run для GigaChat Review не требовался именно потому, что обе Review-клетки уже были закрыты. Его слабость относится к Page-формату, а не к обзорам.

## Что показал финальный повтор

- Page gap-only run `34403213261`: 68 ранее проблемных клеток, завершён успешно.
- Review gap-only run `34403288840`: 28 ранее проблемных клеток, завершён успешно.
- Qwen 3.6 / Wolfenstein 3D Page: contract pass. Это закрывает её Page-матрицу.
- Qwen 3.6 / Spore Review: 1857 слов, 7 разделов, contract pass. Mafia Review не завершился из-за Groq OTPM limit, поэтому Qwen не выбран Review-моделью.
- Qwen 3.8 / Mass Effect Page: contract pass; Dave повторно упёрся в Groq limit. Spore Review: 1240 слов, contract fail.
- GigaChat / Dave и Far Cry Page: повторно нарушил Page block format. Это подтверждённая слабость именно как Page-builder.
- Gemini 3.7 / Mafia Review: 1436 слов, 8 разделов — текст получен, но ниже минимального объёма контракта.
- Gemini 3.8 Page при рабочем API повторно выдавал неполные Page bundles; остальные клетки снова ограничивались quota/high-demand.
- Nemotron 3 Ultra: Page passes на Far Cry, Jack Orlando и Mafia; Mafia Review 1614 слов / 9 разделов — contract pass, Spore Review 986 слов — fail.
- Nemotron 3 Super: Spore Page pass; Spore Review 1678 слов / 8 разделов, но текущий validator не принял итоговый контракт; модель остаётся нестабильной по формату.
- OpenRouter-only GLM / MiniMax / Gemma и часть других повторов упёрлись в отсутствие доступных credits/route. Это фиксируется как operational availability, а не как редакционный проигрыш.

## Что именно утверждено

1. **Page и Review выбираются отдельно.** Они не обязаны использовать одну и ту же модель.
2. Внутри одной страницы нельзя смешивать модели: Qwen 3.6 делает Subtitle + Description + Features целиком.
3. Review пишет GigaChat 3 Ultra отдельным pipeline и его failure никогда не блокирует публикацию Game Page.
4. Provider errors (402/429/503/OAuth) хранятся отдельно от editorial quality.
5. Любой готовый Page/Review проходит evidence/claim audit перед публикацией.

## Production selection

| Модуль | Утверждённая модель | Статус |
|---|---|---|
| Game Page: Subtitle + Description + Features | **Qwen 3.6 27B** | **APPROVED** |
| Review | **GigaChat 3 Ultra** | **APPROVED** |

## Где смотреть тексты

Публичная страница сравнения читает `page-results.json` и `review-results.json`. В них теперь слиты исходные успешные outputs и результаты финального gap-only rerun. Повтор заменяет только соответствующую проблемную клетку; старый успешный текст не заменяется поздней технической ошибкой провайдера.
