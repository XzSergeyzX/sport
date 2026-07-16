-- OpenAI quota is not available; route workout/program parsing through the
-- already-provisioned Anthropic provider used by the coach.
-- Prices are USD per 1M tokens and are used by the shared budget guard.
update public.ai_model_routes
set provider = 'anthropic',
    model = 'claude-sonnet-4-6',
    price_in = 3.00,
    price_out = 15.00,
    updated_at = now()
where intent = 'program_import';
