import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OpenAIImageProvider, ProviderError, TINY_PNG_B64 } = require('../src/providers/image.js');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('OpenAI adapter sends server-side request and parses base64 image', async () => {
  let seen;
  await withServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-123' });
      res.end(
        JSON.stringify({
          data: [{ b64_json: TINY_PNG_B64, revised_prompt: 'revised' }],
        })
      );
    });
  }, async (baseUrl) => {
    const provider = new OpenAIImageProvider({
      apiKey: 'test-key-not-real',
      baseUrl,
      timeoutMs: 1000,
    });
    const result = await provider.generate({
      model: 'gpt-image-1',
      prompt: 'poster',
      count: 1,
      size: '1024x1024',
    });
    assert.equal(seen.auth, 'Bearer test-key-not-real');
    assert.equal(seen.body.model, 'gpt-image-1');
    assert.equal(seen.body.n, 1);
    assert.match(result.images[0].dataUrl, /^data:image\/png;base64,/);
    assert.equal(result.providerRequestId, 'req-123');
  });
});

test('4xx is a definite failure and 5xx is uncertain', async () => {
  let status = 400;
  await withServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'do not leak this' } }));
  }, async (baseUrl) => {
    const provider = new OpenAIImageProvider({
      apiKey: 'test-key-not-real',
      baseUrl,
      timeoutMs: 1000,
    });
    await assert.rejects(
      () => provider.generate({ model: 'gpt-image-1', prompt: 'x', count: 1, size: 'auto' }),
      (error) => error instanceof ProviderError && error.definiteFailure === true
    );
    status = 503;
    await assert.rejects(
      () => provider.generate({ model: 'gpt-image-1', prompt: 'x', count: 1, size: 'auto' }),
      (error) => error instanceof ProviderError && error.definiteFailure === false
    );
  });
});

test('timeout and empty data are held for reconciliation rather than refunded blindly', async () => {
  await withServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    }, 400);
  }, async (baseUrl) => {
    const provider = new OpenAIImageProvider({
      apiKey: 'test-key-not-real',
      baseUrl,
      timeoutMs: 100,
    });
    await assert.rejects(
      () => provider.generate({ model: 'gpt-image-1', prompt: 'x', count: 1, size: 'auto' }),
      (error) => error instanceof ProviderError && error.definiteFailure === false
    );
  });
});

test('unconfigured registry reports unavailable and refuses to call a provider', () => {
  const { createProviderRegistry } = require('../src/providers/image.js');
  const registry = createProviderRegistry({
    appEnv: 'production',
    ai: {
      provider: 'openai',
      openaiKey: '',
      openaiBaseUrl: 'https://api.openai.com/v1',
      timeoutMs: 1000,
    },
  });
  assert.deepEqual(registry.status('openai'), { provider: 'openai', configured: false });
  assert.throws(() => registry.get('openai'), /尚未配置/);
});
