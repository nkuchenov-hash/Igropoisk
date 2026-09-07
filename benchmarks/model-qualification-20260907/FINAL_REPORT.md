# Игропоиск — финальная квалификация моделей для Page и Review

Дата: 2026-09-07

## Итог

### Page (Subtitle + Description + Features)

**Победителя, которого можно безопасно ставить в production как единую Page-модель, нет.**

Это не проблема формата теста: после исправления chunking, повторных прогонов и отделения provider-errors от качества текста основной дефект сохранился у самих успешных outputs — модели добавляют детали, которых нет в каноническом корпусе, смешивают версии/порты и иногда проходят структурный validator при фактически неверном тексте.

Лучшие наблюдавшиеся кандидаты:

1. **MiniMax M2.7** — лучший общий баланс редакционного качества среди моделей, давших полный набор Page outputs; 7/7 outputs, 5/7 structural pass в corrected full-corpus run. Минус: всё ещё добавляет неподтверждённые детали и иногда превращает приблизительный факт в точный.
2. **Qwen 3.6 27B** — 6/7 structural pass, обычно хороший редакционный русский и хорошая работа с форматом. Минус: заметные hallucinations, отдельные ошибки терминов/имён и фактические добавления сверх evidence.
3. **GPT-OSS 120B** — лучший по формальной структуре: 7/7 structural pass. Но структурная стабильность обманчива: ручной аудит нашёл слишком много неподтверждённых деталей, смешивание версий и прямые фактические ошибки. Поэтому он не является фактическим победителем Page.
4. **Qwen 3.8 27B** — сильный по отдельным страницам, но нестабилен и регулярно конкретизирует то, чего нет в evidence.
5. **GigaChat 3 Ultra** — отдельные тексты выразительные, но direct rerun на Dangerous Dave снова сломал контракт блоков и добавил неподтверждённую конкретику.

**Практический вывод:** Page нельзя сейчас отдавать одной модели одним большим запросом. Subtitle, Description и Features нужно квалифицировать отдельно и давать модели только структурированный набор разрешённых claims. Наличие факта в памяти модели не является разрешением использовать его.

### Review

**Текущий фактический лидер: GigaChat 3 Ultra.**

Он единственный из полноценно проверенных кандидатов стабильно показал способность писать большой связный журнальный обзор после full-corpus evidence pass:

- Mafia: успешный ранее corrected full-corpus output — 2124 слов, 9 разделов, structural pass;
- Spore: свежий direct-provider output — 1965 слов, 8 разделов, structural pass.

При этом **GigaChat ещё нельзя пускать в production без дополнительного evidence guardrail**. Ручной аудит обоих обзоров нашёл красивые, но не всегда подтверждённые корпусом атмосферные и системные подробности. То есть его сильная сторона — длинная редакционная проза; слабая — стремление достраивать правдоподобную конкретику.

MiniMax M2.7 был ближайшим альтернативным кандидатом по стилю, но его старые Review outputs не выполнили текущий контракт длины/структуры и также содержали неподтверждённые детали. GPT-OSS 20B/120B в длинном Review оказались менее стабильными и более склонными к checklist-подаче или неподтверждённым UI/системным деталям.

Gemini 3.8 Flash и Gemini 3.7 Flash **не проиграли по качеству**: финальная direct Review qualification не смогла их оценить из-за дневного API quota limit (20 requests/day/model). Их статус: **NOT QUALIFIED — PROVIDER QUOTA**, а не low quality.

## Почему прежние рейтинги были нестабильны

В ходе квалификации были отдельно выявлены и устранены несколько технических факторов, которые раньше ошибочно выглядели как разница между моделями:

- benchmark truncation корпуса;
- слишком большой single-request corpus;
- Groq TPM/OTPM limits;
- OpenRouter free-route 404/429;
- OpenRouter concurrent `in_flight_budget_exhausted`;
- OpenRouter account credit exhaustion;
- Gemini daily free-tier quota;
- единичные GigaChat OAuth/network failures.

Ни один такой failure не считается проигрышем модели по качеству.

## Что считалось доказательством

Для всех игр использовался один и тот же замороженный canonical corpus: весь readable `text`, который реально скачал и сохранил Игропоиск. Benchmark больше не выбирал 6–8 источников и не обрезал каждый источник до 650/1200 символов.

Page test: 7 игр — Dangerous Dave in the Haunted Mansion, Far Cry (2004), Jack Orlando: A Cinematic Adventure, Mafia: The City of Lost Heaven, Mass Effect (2007), Wolfenstein 3D, Spore.

Review test: Mafia + Spore.

## Главный методологический результат

`structural_contract_ok = true` не означает хороший текст.

Пример: GPT-OSS 120B прошёл Page structural contract 7/7, но ручной fact audit обнаружил ошибки, которых автоматический validator не видел. Поэтому production gate должен проверять не только форму, длину и наличие блоков, а связь каждого конкретного утверждения с evidence.

## Решение для следующей версии pipeline

1. Evidence pass формирует структурированные atomic claims с provenance.
2. Subtitle / Description / Features получают только разрешённые claims, а не сырой огромный corpus плюс право модели «додумать» связки.
3. Каждый Page-блок квалифицируется отдельно; допускаются разные модели для разных блоков.
4. Review остаётся отдельным skill/pipeline. GigaChat 3 Ultra — текущий кандидат №1 для prose generation, но финальный текст проходит claim-level evidence audit.
5. Provider availability хранится отдельно от editorial score. 429/402/404/OAuth не снижает редакционный рейтинг модели.

## Статус моделей в этой квалификации

| Model | Page | Review | Вывод |
|---|---|---|---|
| MiniMax M2.7 | сильный кандидат, но не fact-safe | неполный текущий контракт | Page shortlist |
| Qwen 3.6 27B | сильный кандидат, но не fact-safe | не доказан как лучший | Page shortlist |
| GPT-OSS 120B | 7/7 structure, слабее по fact discipline | нестабильный long-form | не выбирать по structural score |
| Qwen 3.8 27B | сильные отдельные outputs, нестабильная factuality | инфраструктурно неполный финальный тест | дополнительный кандидат |
| GigaChat 3 Ultra | нестабильный Page contract | лучший фактический long-form результат | **Review candidate #1** |
| Gemini 3.8 Flash | provider quota не дал финально квалифицировать | provider quota | NOT QUALIFIED, не проигравший |
| Gemini 3.7 Flash | provider quota не дал финально квалифицировать | provider quota | NOT QUALIFIED, не проигравший |
| GLM 5.2 | финальная оценка заблокирована provider credits | финальная оценка заблокирована provider credits | NOT QUALIFIED |
| Nemotron 3 Ultra | provider unavailable/credits | provider unavailable/credits | NOT QUALIFIED |
| Nemotron 3 Super | provider unavailable/credits | provider unavailable/credits | NOT QUALIFIED |
| MiniMax M3 | provider/route instability | provider/route instability | NOT QUALIFIED |
| Dots3-Note Preview | route unavailable | route unavailable | NOT QUALIFIED |
| Gemma 4 31B | provider unavailable/credits | provider unavailable/credits | NOT QUALIFIED |
| Gemma 4 26B A4B | provider unavailable/credits | provider unavailable/credits | NOT QUALIFIED |
| GPT-OSS 20B | хороший structural coverage, factuality слабее | long-form слабее лидера | резервный, не победитель |

## Финальное решение

- **Page:** не закреплять одну модель. Текущая квалификация не дала production-safe победителя. Следующий тест должен быть отдельным для Subtitle / Description / Features после claim-lock.
- **Review:** **GigaChat 3 Ultra — текущий победитель по реально полученным long-form обзорам**, но только вместе с жёстким evidence/claim audit; без него production-ready моделью считать нельзя.
