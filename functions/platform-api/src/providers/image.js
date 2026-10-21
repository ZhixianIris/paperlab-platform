'use strict';

const { AppError } = require('../errors');

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

class ProviderError extends Error {
  constructor(message, { definiteFailure = false, code = 'provider_error', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.definiteFailure = definiteFailure;
    this.code = code;
  }
}

function mimeFromBase64(value) {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('UklGR')) return 'image/webp';
  if (value.startsWith('iVBOR')) return 'image/png';
  return 'application/octet-stream';
}

class OpenAIImageProvider {
  constructor({ apiKey, baseUrl, timeoutMs }) {
    this.name = 'openai';
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async generate({ model, prompt, count, size }) {
    if (!this.configured) {
      throw new ProviderError('OpenAI provider is not configured', {
        definiteFailure: true,
        code: 'provider_not_configured',
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, prompt, n: count, size }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error && (error.name === 'AbortError' || controller.signal.aborted);
      throw new ProviderError(aborted ? 'Provider request timed out' : 'Provider network failure', {
        definiteFailure: false,
        code: aborted ? 'provider_timeout' : 'provider_network_error',
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const requestId =
      response.headers.get('x-request-id') || response.headers.get('request-id') || null;
    if (!response.ok) {
      // 4xx means the request was rejected and no image was produced. 5xx and
      // gateway failures cannot prove that the upstream job was not accepted.
      const definite = response.status >= 400 && response.status < 500;
      throw new ProviderError(`Provider returned HTTP ${response.status}`, {
        definiteFailure: definite,
        code: `provider_http_${response.status}`,
      });
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new ProviderError('Provider returned an unreadable response', {
        definiteFailure: false,
        code: 'provider_invalid_response',
        cause: error,
      });
    }
    const items = Array.isArray(body?.data) ? body.data : [];
    const images = [];
    for (const item of items) {
      if (item?.b64_json) {
        const mimeType = mimeFromBase64(item.b64_json);
        if (mimeType === 'application/octet-stream') continue;
        images.push({ mimeType, dataUrl: `data:${mimeType};base64,${item.b64_json}` });
      } else if (item?.url && /^https:\/\//i.test(item.url)) {
        images.push({ mimeType: 'image/png', url: item.url });
      }
    }
    if (images.length === 0) {
      throw new ProviderError('Provider returned no image', {
        definiteFailure: false,
        code: 'provider_empty_result',
      });
    }
    return {
      images: images.slice(0, count),
      revisedPrompt: typeof items[0]?.revised_prompt === 'string' ? items[0].revised_prompt : null,
      providerRequestId: requestId,
    };
  }
}

class FixtureImageProvider {
  constructor() {
    this.name = 'fixture';
  }

  get configured() {
    return process.env.APP_ENV === 'test';
  }

  async generate({ prompt, count }) {
    if (!this.configured) {
      throw new ProviderError('Fixture provider is test-only', {
        definiteFailure: true,
        code: 'provider_not_configured',
      });
    }
    if (prompt.includes('__FAIL_DEFINITE__')) {
      throw new ProviderError('Fixture definite failure', {
        definiteFailure: true,
        code: 'fixture_definite_failure',
      });
    }
    if (prompt.includes('__FAIL_UNCERTAIN__')) {
      throw new ProviderError('Fixture uncertain failure', {
        definiteFailure: false,
        code: 'fixture_uncertain_failure',
      });
    }
    if (prompt.includes('__SLOW__')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return {
      images: Array.from({ length: count }, () => ({
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      })),
      revisedPrompt: null,
      providerRequestId: `fixture-${Date.now()}`,
    };
  }
}

function createProviderRegistry(config) {
  const adapters = new Map();
  adapters.set(
    'openai',
    new OpenAIImageProvider({
      apiKey: config.ai.openaiKey,
      baseUrl: config.ai.openaiBaseUrl,
      timeoutMs: config.ai.timeoutMs,
    })
  );
  if (config.appEnv === 'test') {
    adapters.set('fixture', new FixtureImageProvider());
  }

  function get(provider) {
    const adapter = adapters.get(provider);
    if (!adapter || !adapter.configured) {
      throw new AppError('provider_not_configured', '该模型供应商尚未配置密钥，暂时无法生成', {
        status: 503,
      });
    }
    return adapter;
  }

  function status(provider) {
    const adapter = adapters.get(provider);
    return {
      provider,
      configured: Boolean(adapter && adapter.configured),
    };
  }

  function publicStatus() {
    const active = adapters.get(config.ai.provider);
    return {
      provider: config.ai.provider,
      configured: Boolean(active && active.configured),
    };
  }

  return { get, status, publicStatus };
}

module.exports = {
  ProviderError,
  OpenAIImageProvider,
  FixtureImageProvider,
  createProviderRegistry,
  TINY_PNG_B64,
};
