-- Коуч (§3): Haiku 4.5 выдавал ломаный украинский и игнорил род → апгрейд на Sonnet 4.6
-- (заметно сильнее в многоязычии и следовании инструкциям). Цены — для оценки бюджета.
update public.ai_model_routes
set model = 'claude-sonnet-4-6', price_in = 3.00, price_out = 15.00, updated_at = now()
where intent = 'coach_chat';
