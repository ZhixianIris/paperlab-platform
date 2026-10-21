-- Generic user-facing labels for the default image model. Technical provider
-- identifiers remain visible only in the platform-admin surface.
update public.model_prices
set display_name = '标准图像模型',
    description = 'AI 图像生成'
where provider = 'openai' and model = 'gpt-image-1';
