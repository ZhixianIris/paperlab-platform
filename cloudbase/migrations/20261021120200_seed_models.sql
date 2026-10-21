-- Catalog seed only. It deliberately contains no users, tenants, admins, balances or orders.
-- The model stays disabled until a platform admin enables it AND the provider key exists
-- in the function environment; a missing key always blocks generation and charging.
insert into public.model_prices (
  provider, model, display_name, description, unit_price_cents, currency,
  enabled, max_images, max_prompt_chars, monthly_budget_cents
)
values (
  'openai', 'gpt-image-1', 'OpenAI GPT Image 1',
  'OpenAI image generation through the server-side provider adapter.',
  500, 'CNY', false, 1, 1000, 10000
)
on conflict (provider, model) do nothing;
