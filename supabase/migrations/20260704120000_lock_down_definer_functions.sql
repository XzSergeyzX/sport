-- БЕЗОПАСНОСТЬ: закрываем дыру в грантах security-definer функций.
--
-- Найдено при работе над delete_account (день-48): `revoke execute ... from anon, authenticated`
-- НЕ снимает дефолтный грант EXECUTE для роли PUBLIC, членами которой являются и anon, и
-- authenticated. Итог — все такие функции были вызываемы анонимно по anon-ключу (публичному,
-- зашит в клиент). Проверено на проде: anon вызывал get_oura_token(любой_uuid) → мог вытащить
-- чужой OURA access-token (нарушение правила «ключи OURA — только на сервере»), store_oura_token
-- → перезаписать; analytics_summary_for/get_analytics_summary → прочитать чужую историю тренировок;
-- ai_budget_check/ai_record_usage → читать/накручивать чужой ИИ-бюджет (можно упереть юзера в кап).
--
-- Правильный паттерн: revoke from PUBLIC (снимает грант со всех), затем явный grant ровно тем
-- ролям, кому функция нужна. service_role тоже член PUBLIC → серверным функциям грант возвращаем
-- явно, иначе Edge Functions отвалятся.
--
-- Функции с ВНУТРЕННЕЙ проверкой (get_leaderboard_pending/review_leaderboard_entry: raise not_admin;
-- триггерные handle_new_user/quota/daily_cap) от утечки гранта не страдают, но приводим к единому
-- паттерну для defense-in-depth и чтобы дыра не воспроизвелась копипастой.

-- ---------- сервер-онли (только service_role: Edge Functions) ----------
revoke execute on function public.store_oura_token(uuid, text)                        from public, anon, authenticated;
revoke execute on function public.get_oura_token(uuid)                                from public, anon, authenticated;
revoke execute on function public.ai_budget_check(uuid)                               from public, anon, authenticated;
revoke execute on function public.ai_record_usage(uuid, integer, integer, numeric, text) from public, anon, authenticated;
revoke execute on function public.analytics_summary_for(uuid)                         from public, anon, authenticated;

grant execute on function public.store_oura_token(uuid, text)                        to service_role;
grant execute on function public.get_oura_token(uuid)                                to service_role;
grant execute on function public.ai_budget_check(uuid)                               to service_role;
grant execute on function public.ai_record_usage(uuid, integer, integer, numeric, text) to service_role;
grant execute on function public.analytics_summary_for(uuid)                         to service_role;

-- ---------- клиентские (только залогиненные; скоупятся auth.uid() внутри) ----------
revoke execute on function public.get_analytics_summary()          from public, anon;
revoke execute on function public.delete_account()                 from public, anon;
revoke execute on function public.get_leaderboard(text)            from public, anon;
revoke execute on function public.get_leaderboard_pending()        from public, anon;
revoke execute on function public.review_leaderboard_entry(uuid, text) from public, anon;

grant execute on function public.get_analytics_summary()          to authenticated;
grant execute on function public.delete_account()                 to authenticated;
grant execute on function public.get_leaderboard(text)            to authenticated;
grant execute on function public.get_leaderboard_pending()        to authenticated;
grant execute on function public.review_leaderboard_entry(uuid, text) to authenticated;
