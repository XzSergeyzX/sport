# Sporty_SM

Expo/React Native приложение для тренировок, grip-рекордов и лидерборда. Private-режим Сергея и
Марии дополнительно включает программы, AI Coach, OURA и цикл.

## Продуктовые роли

- `grip` — роль всех новых пользователей: свободные тренировки, эспандеры, рекорды, аналитика и
  лидерборд; без Programs/AI/Health/Cycle.
- `full` — private athlete; сейчас только Мария.
- `admin` — `full` + moderation; сейчас только Сергей.

Источник роли — защищённая таблица `user_roles`. Роль не хранится в редактируемом профиле.

## Стек

- Expo SDK 54, React Native 0.81, TypeScript, Expo Router;
- NativeWind, TanStack Query + AsyncStorage persistence;
- Supabase Postgres/Auth/Edge Functions/RLS;
- AI gateway с Claude/OpenAI/Gemini adapters;
- UI локали: только `en` и `uk`.

SDK 54 зафиксирован ради Expo Go. Не обновляйте Expo/React Native без отдельного согласования.

## Локальный запуск

```powershell
npm install
npx expo start --port 8090
```

Нужен `.env` на основе `.env.example` с публичными Supabase URL/anon key. Серверные AI/OURA ключи
хранятся только в Supabase Edge secrets и никогда не добавляются в клиентский `.env`.

## Проверки

```powershell
npx tsc --noEmit
npm run check:functions
npm test
```

Автоматические тесты должны защищать спортивные расчёты, роли/RLS, offline replay и критические
пользовательские пути. Полная стратегия описана в `docs/USER_FLOWS.md` §7.

## Документация

- `docs/SPEC.md` — продуктовый и архитектурный контракт;
- `docs/BACKLOG.md` — открытые решения и порядок работ;
- `docs/USER_FLOWS.md` — актуальные экраны, роли и сценарии;
- `docs/PROGRESS.md` — состояние main, деплой и журнал сессий;
- `AGENTS.md` — обязательные правила работы с проектом.

## Supabase и EAS

```powershell
npx supabase db push
npx supabase functions deploy <name>
```

`eas.json` содержит development/preview/production профили. Android package настроен; iOS
bundle identifier и TestFlight выполняются только по явной команде владельца проекта.
