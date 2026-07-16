# Sporty_SM — актуальные пользовательские сценарии

> Состояние на 2026-07-16, commit `33008cb`. Этот документ описывает фактические экраны и
> продуктовые правила. Целевой контракт — `SPEC.md`, приоритеты — `BACKLOG.md`, история —
> `PROGRESS.md`. Документация на русском; UI только `en`/`uk`.

## 0. Продукт в двух режимах

### Grip/community — все обычные пользователи

Новый аккаунт автоматически получает роль `grip`.

Доступно:

- свободно начать и вести тренировку без программы;
- добавлять упражнения и подходы, отмечать сторону/читинг;
- выбирать эспандер и тип установки в grip-подходе;
- смотреть историю, личные силовые/time/grip-рекорды;
- отправлять результат в лидерборд и следить за модерацией;
- управлять профилем, своими упражнениями и эспандерами.

Недоступно:

- Programs и AI-import;
- Coach/STT;
- OURA, recovery и cycle;
- moderation.

### Private athlete — только Сергей и Мария

- Сергей: `admin` — весь private-функционал + moderation.
- Мария: `full` — весь private-функционал без moderation.
- Эти роли выдаются вручную через `user_roles`; автоматического апгрейда роли нет.
- Любая AI Edge Function проверяет роль серверно. Скрытие таба — только UX, не защита.

## 1. Маршруты и навигация

| Маршрут | Назначение | Grip | Full | Admin |
|---|---|---:|---:|---:|
| `/` | gate сессии/onboarding | ✅ | ✅ | ✅ |
| `/auth` | вход и регистрация | ✅ | ✅ | ✅ |
| `/onboarding` | язык, единицы, пол, cycle preference | ✅ | ✅ | ✅ |
| `/workouts` | старт, active workout, история, AI past-import | ✅ без AI | ✅ | ✅ |
| `/workout/[id]` | запись тренировки | ✅ | ✅ | ✅ |
| `/summary/[id]` | итог тренировки | ✅ | ✅ | ✅ |
| `/analytics` | Training / Records / Recovery | ✅ без private recovery | ✅ | ✅ |
| `/leaderboard` | grip/dynamometer leaderboard | ✅ | ✅ | ✅ |
| `/programs` | список и AI-import программ | скрыт | ✅ | ✅ |
| `/program/[id]` | редактор/старт программы | скрыт | ✅ | ✅ |
| `/coach` | мультитредовый AI-коуч | скрыт | ✅ | ✅ |
| `/health` | OURA и цикл | скрыт | ✅ при данных | ✅ при данных |
| `/account` | настройки | ✅ | ✅ | ✅ |
| `/exercises` | свои упражнения | ✅ | ✅ | ✅ |
| `/grippers` | каталог/свои эспандеры | ✅ | ✅ | ✅ |
| `/proof-rules` | правила видео-пруфа | ✅ | ✅ | ✅ |
| `/moderation` | approve/reject заявок | ❌ | ❌ | ✅ |

Нижнее меню: Workouts · Programs · Coach · Analytics · Health · Leaderboard. Programs/Coach
скрываются у `grip`; Health скрывается у `grip` и при отсутствии OURA/cycle; Leaderboard можно
скрыть пользовательским тумблером. Account открывается кнопкой настроек.

## 2. Первый запуск

1. `/` ждёт восстановления Supabase session.
2. Без session → `/auth`.
3. После входа без `profile.onboarded_at` → `/onboarding`.
4. Onboarding сохраняет `language`, `units`, gender и opt-in cycle tracking.
5. После onboarding → `/workouts`.
6. `user_roles` для нового пользователя создаётся как `grip`.

Открытые хвосты: reset password, email-confirm deep link, рост в UI, более явный финальный CTA,
privacy/terms/export перед store release.

## 3. Основной grip-сценарий

### 3.1 Свободная тренировка

1. Пользователь нажимает «Почати тренування».
2. Клиент генерирует UUID, сразу сеет workout в TanStack cache и открывает `/workout/[id]`.
3. Серверная запись уходит durable mutation; без сети остаётся paused и переживает restart.
4. Пользователь добавляет упражнения и подходы.
5. Для grip-упражнения выбирает модель эспандера и `set_type`.
6. Вводит reps/time, RPE, сторону/читинг; может собрать superset/EMOM/E2MOM/AMRAP.
7. «Завершити» локально ставит `ended_at`, сразу открывает summary и синхронизируется фоном.
8. После sync SQL/RPC обновляет records/tonnage/analytics.

Инварианты до beta:

- только одна активная тренировка на пользователя;
- изменения одного set применяются в порядке ввода;
- offline → restart → reconnect не создаёт дублей и не теряет данные;
- пустой `sets.meta` очищает старые side/cheat/gripper значения.

### 3.2 Эспандеры и личные рекорды

1. Account → «Мої еспандери» позволяет выбрать каталог или создать личный gripper с optional RGC.
2. В workout grip-set хранит `gripper_id` и `set_type` в `sets.meta`; weight для него `null`.
3. Analytics → Records показывает grip-топы по типу установки.
4. Рекорды вычисляются SQL/RPC из истории подходов; отдельной PR-таблицы нет.

Известный долг: `meta.gripper_id` не FK; удаление личного gripper может осиротить историческое
отображение. Нужен restrict/soft-delete либо snapshot имени/RGC в set meta.

### 3.3 Лидерборд

1. Пользователь выбирает dynamometer или gripper board и фильтры. Динамометры ранжируются
   раздельно по прибору; `XF-300 · 14 mm` и `XF-300 · 18 mm` — две независимые категории.
2. Для динамометра одна заявка содержит результат ровно одной явно выбранной руки. Доступны
   рейтинг лучшего результата на приборе независимо от руки, отдельные левая/правая, сумма
   лучших левой+правой одного пользователя на том же приборе и абсолютный одноручный рейтинг
   среди всех моделей. Старые заявки без руки видны только в общем/абсолютном рейтингах.
3. Отправляет результат, дату и URL видео с разрешённого хоста.
4. Сервер принудительно создаёт `pending`; пользователь не может self-approve.
5. Admin approve/reject через защищённый RPC.
6. Автор получает realtime/local/remote verdict notification и видит статус заявки.

Открыто: edit pending/rejected entry, error/retry UI, уведомление «тебя подвинули», preferences и
digest/reminders без спама.

## 4. Private-сценарии Сергея и Марии

### 4.1 Программа

1. Programs показывает максимум 6 пользовательских программ.
2. Можно создать пустую вручную либо импортировать текст через AI.
3. Редактор поддерживает блоки, упражнения, reorder, sets, side/meta и custom exercises.
4. Старт строит полное дерево workout локально и использует тот же offline durable writer.

Открыто: starter catalog 6–10 программ, multi-week/day модель, active-program progress/adherence,
preview AI-разбора, relink unmatched exercises и транзакционный commit импорта.

### 4.2 Coach

1. Coach показывает список тредов и позволяет начать новую беседу.
2. Сообщение сохраняется в выбранный thread; Edge agent получает ограниченную историю.
3. Tools читают профиль, тренировки, exercise history, SQL-records, recovery, cycle и facts.
4. `remember_fact` — единственный write-tool; спортивные метрики модель не вычисляет.
5. Native STT записывает максимум 20 секунд, передаёт audio в Edge и удаляет временный файл.
6. Offline отправка блокируется и не попадает в replay платных AI-вызовов.

Открыто: различать quota/role/provider ошибки, rename/delete/search тредов, dedup/TTL facts,
morning/weekly brief и понятное отображение лимитов.

### 4.3 OURA и цикл

1. Health принимает OURA PAT через `oura-connect`; токен сохраняется в `private.oura_tokens`.
2. Ручной sync загружает до 365 дней в `health_snapshots`.
3. Health и Analytics показывают readiness/sleep/HRV/RHR/temp, trends и correlations.
4. Cycle tracking хранит даты дня 1 в `cycle_periods`; current day/phase вычисляется из истории.
5. В Analytics можно отметить день 1 задним числом.

Открыто: OAuth + refresh/disconnect, daily cron, индивидуальные фазы и восстановление UI для
edit/delete/history дат цикла. DB-функции edit/delete есть, но текущий экран их не вызывает.

## 5. Offline и синхронизация

Offline-first реализован только для горячего контура тренировки:

- persisted TanStack Query cache в AsyncStorage;
- NetInfo → `onlineManager`;
- mutation defaults по стабильным `mutationKey`;
- paused mutations переживают restart;
- client UUID + idempotent upsert;
- optimistic UI;
- `SyncStatus` показывает pending/failed и даёт retry.

Намеренно online-only:

- Coach, program/workout AI-import — платные и не повторяются автоматически;
- profile/program/cycle/gripper edits и leaderboard submission пока не durable.

Analytics SQL не видит ещё не синхронизированный workout; UI должен честно помечать stale/offline
данные, а не создавать впечатление, что локальная тренировка уже вошла в серверные агрегаты.

## 6. Ошибки и состояния

Каждый data-screen должен отличать четыре состояния:

1. loading;
2. empty — успешный ответ без данных;
3. stale/offline — показан сохранённый кэш;
4. error — загрузка не удалась, видна причина/повтор.

Сейчас это системно не завершено: ряд query errors выглядит как пустой экран. Приоритетные экраны
для исправления: Workouts, Programs, Analytics, Leaderboard/Moderation, Health и Account.

## 7. Тестовая стратегия

### Уровень 1 — быстрые unit-тесты на каждый PR

- спортивные формулы: tonnage, side ×2, reps/time, 1RM, cycle phase;
- нормализация units/meta/gripper/set type;
- role/feature policy (`grip` vs `full/admin`);
- преобразование program → offline workout;
- error-code mapping и pure selectors.

### Уровень 2 — integration

- TanStack mutation defaults: optimistic patch, retry, replay и отсутствие дублей;
- Supabase migrations/RLS/RPC на локальном Supabase: владелец/чужой пользователь/admin;
- unique active workout;
- transaction rollback для imports;
- AI gateway budget/role gates с mocked provider, без реальной оплаты модели.

### Уровень 3 — E2E smoke

На Android preview и затем iOS/TestFlight через Maestro:

- signup → onboarding → grip tabs;
- start workout → add gripper set → finish → record;
- airplane mode → kill app → reopen → reconnect → sync;
- leaderboard submit → admin approve → verdict;
- private program start и Coach offline-block.

Не делаем ставку на большие snapshot-тесты: они хрупкие и плохо доказывают пользовательский путь.
Критерий качества — защита данных, ролей, расчётов и 5–7 сквозных smoke-сценариев.

## 8. Сборка и релиз

- Expo SDK строго 54; обновление SDK/React Native только по отдельному согласованию.
- `eas.json`, Android package, preview/production профили и EAS Update уже есть.
- Android preview работает без Metro.
- Для iOS ещё нужен bundle identifier и Apple Developer/TestFlight; запускать только по явной
  команде Сергея.
- До публичных stores: reset password, privacy/terms, export данных, metadata/privacy declarations.

## 9. Текущий порядок завершения

1. P0 data integrity: single active workout, ordered set updates, clear meta.
2. Транзакционные AI-imports и общий error/retry UX.
3. Тестовая пирамида: unit → Supabase integration → Maestro smoke.
4. Вернуть cycle edit/delete UI.
5. Starter program catalog → active program progress.
6. Exercise analytics drilldown и Coach error UX.
7. Релизные обязательства; iOS/TestFlight — отдельным решением.
