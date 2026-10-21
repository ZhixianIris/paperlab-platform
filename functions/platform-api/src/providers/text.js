'use strict';

const { AppError } = require('../errors');

class PlannerProviderError extends Error {
  constructor(message, { code = 'planner_provider_error', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PlannerProviderError';
    this.code = code;
  }
}

const TOOL_CAPABILITIES = Object.freeze([
  ['pdf.merge', 'merge two or more PDFs'],
  ['pdf.split', 'extract a page range into one PDF'],
  ['pdf.rotate', 'rotate selected/all PDF pages by 90/180/270'],
  ['pdf.delete', 'delete selected PDF pages'],
  ['pdf.organize', 'reorder PDF pages with an explicit order'],
  ['pdf.blanks', 'insert blank pages'],
  ['pdf.numbers', 'add page numbers'],
  ['pdf.watermark', 'add a text watermark to PDF pages'],
  ['pdf.crop', 'crop PDF page margins'],
  ['pdf.metadata', 'edit PDF title/author/subject/keywords'],
  ['pdf.to-image', 'export PDF pages as PNG/JPEG'],
  ['pdf.to-text', 'extract native PDF text'],
  ['pdf.compress', 'lossy rasterize PDF to smaller images'],
  ['pdf.grayscale', 'rasterize PDF pages to grayscale'],
  ['pdf.background', 'clean light background of rasterized PDF pages'],
  ['pdf.split-pages', 'split each page into a separate PDF'],
  ['pdf.resize-pages', 'resize PDF pages to A4/A3/Letter'],
  ['pdf.nup', 'impose 2-up or 4-up print sheets'],
  ['image.rotate', 'rotate an image 90/180/270'],
  ['image.flip', 'flip an image horizontally/vertically'],
  ['image.adjust', 'adjust image brightness/contrast/saturation/sepia/blur'],
  ['image.watermark', 'add a text watermark to an image'],
  ['image.frame', 'add a color border'],
  ['image.round', 'create transparent rounded corners'],
  ['image.strip', 're-encode and remove common metadata'],
  ['image.convert', 'convert PNG/JPEG/WebP'],
  ['image.compress', 'compress an image'],
  ['image.resize', 'resize an image proportionally'],
  ['image.collage', 'join multiple images'],
  ['image.batch', 'batch convert/compress/resize images'],
]);

function systemPrompt() {
  return [
    'You are PaperLab Planner. Convert a Chinese/English file-editing request into a strict JSON plan.',
    'The browser executes only allowlisted local tools. You never receive file bytes and must never invent file contents, regions, page numbers, or success.',
    'Return JSON only with one of these shapes:',
    '{"kind":"plan","fileIds":["..."],"steps":[{"toolKey":"pdf.rotate","args":{"angle":90,"allPages":true,"range":""}}],"requiresConfirmation":true,"reason":"short explanation","message":"short user-facing note"}',
    '{"kind":"needs_clarification","message":"one concrete question"}',
    '{"kind":"unsupported","message":"brief reason"}',
    '{"kind":"requires_content_consent","message":"explain that page text would need consent"}',
    'Rules: use only tools in the capability list; fileIds must come from the supplied metadata; page numbers must be positive; no shell, SQL, URLs, code or extra keys. For interactive region tools (crop, pixelate, blur, mask) return needs_clarification and tell the user to use the manual editor. For destructive or lossy operations set requiresConfirmation true. If the request is ambiguous, ask one question instead of guessing.',
    `Allowed tools:\n${TOOL_CAPABILITIES.map(([key, description]) => `- ${key}: ${description}`).join('\n')}`,
  ].join('\n');
}

class OpenAITextProvider {
  constructor({ apiKey, baseUrl, model, timeoutMs }) {
    this.name = 'openai';
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.apiKey && this.model);
  }

  async plan({ prompt, files }) {
    if (!this.configured) {
      throw new PlannerProviderError('Planner provider is not configured', {
        code: 'provider_not_configured',
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt() },
            {
              role: 'user',
              content: JSON.stringify({
                instruction: prompt,
                files: files.map((file) => ({
                  fileId: file.fileId,
                  kind: file.kind,
                  pageCount: file.pageCount,
                  width: file.width,
                  height: file.height,
                  hasTextLayer: file.hasTextLayer,
                  sizeBytes: file.sizeBytes,
                })),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error && (error.name === 'AbortError' || controller.signal.aborted);
      throw new PlannerProviderError(aborted ? 'Planner request timed out' : 'Planner network failure', {
        code: aborted ? 'planner_timeout' : 'planner_network_error',
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || null;
    if (!response.ok) {
      throw new PlannerProviderError(`Planner returned HTTP ${response.status}`, {
        code: `planner_http_${response.status}`,
      });
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new PlannerProviderError('Planner returned unreadable JSON', {
        code: 'planner_invalid_response',
        cause: error,
      });
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new PlannerProviderError('Planner returned no message', {
        code: 'planner_empty_response',
      });
    }
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return { raw: JSON.parse(cleaned), providerRequestId: requestId };
    } catch (error) {
      throw new PlannerProviderError('Planner returned invalid JSON', {
        code: 'planner_invalid_json',
        cause: error,
      });
    }
  }
}

class FixtureTextProvider {
  constructor() {
    this.name = 'fixture';
  }

  get configured() {
    return process.env.APP_ENV === 'test';
  }

  async plan({ prompt, files }) {
    if (!this.configured) {
      throw new PlannerProviderError('Fixture planner is test-only', {
        code: 'provider_not_configured',
      });
    }
    const fileIds = files.map((file) => file.fileId);
    const first = files[0];
    if (prompt.includes('__EVIL__')) {
      return {
        raw: {
          kind: 'plan',
          fileIds,
          steps: [{ toolKey: 'system.exec', args: { command: 'rm -rf /' } }],
          requiresConfirmation: true,
          reason: 'malicious fixture output',
        },
        providerRequestId: 'fixture-evil',
      };
    }
    if (prompt.includes('第二页') || prompt.includes('第2页')) {
      return {
        raw: {
          kind: 'plan',
          fileIds,
          steps: [
            { toolKey: 'pdf.delete', args: { range: '2' } },
            { toolKey: 'pdf.rotate', args: { angle: 90, allPages: true, range: '' } },
          ],
          requiresConfirmation: true,
          reason: '删除第 2 页，再旋转剩余页面 90 度',
          message: '复杂指令已由云端规划器解析，执行仍在本机完成。',
        },
        providerRequestId: 'fixture-plan',
      };
    }
    if (first?.kind === 'image' && prompt.includes('压缩')) {
      return {
        raw: {
          kind: 'plan',
          fileIds,
          steps: [{ toolKey: 'image.compress', args: { quality: 70, maxSizeMB: 0.8, maxDimension: 2400 } }],
          requiresConfirmation: true,
          reason: '压缩图片',
          message: '复杂指令已由云端规划器解析，执行仍在本机完成。',
        },
        providerRequestId: 'fixture-compress',
      };
    }
    return {
      raw: {
        kind: 'needs_clarification',
        message: '请说明要使用的工具、页码或区域。',
      },
      providerRequestId: 'fixture-clarify',
    };
  }
}

function createPlannerRegistry(config) {
  const adapters = new Map();
  adapters.set('openai', new OpenAITextProvider({
    apiKey: config.planner.apiKey,
    baseUrl: config.planner.baseUrl,
    model: config.planner.model,
    timeoutMs: config.planner.timeoutMs,
  }));
  if (config.appEnv === 'test') adapters.set('fixture', new FixtureTextProvider());
  const active = adapters.get(config.planner.provider);

  return {
    get() {
      if (!active || !active.configured) {
        throw new AppError('planner_not_configured', '复杂指令规划暂未配置，基础本地指令仍可使用。', {
          status: 503,
        });
      }
      return active;
    },
    publicStatus() {
      return {
        configured: Boolean(active && active.configured),
      };
    },
  };
}

module.exports = {
  PlannerProviderError,
  OpenAITextProvider,
  FixtureTextProvider,
  createPlannerRegistry,
  systemPrompt,
};
