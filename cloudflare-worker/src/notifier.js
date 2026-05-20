export function renderTemplate(template, vars) {
  const msg = String(vars.message ?? '');
  if (template === '$MSG') return msg;
  return template
    .split('$MSG')
    .join(msg)
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key) => String(vars[key.trim()] ?? ''));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function text(title, message) {
  return `${title}\n\n${message}`;
}

function tokenOf(settings) {
  return settings.notify_token || settings.pushplus_token || '';
}

function urlFor(settings) {
  if (settings.webhook_type === 'bark') {
    return settings.webhook_url || (tokenOf(settings) ? `https://api.day.app/${encodeURIComponent(tokenOf(settings))}` : '');
  }
  if (settings.webhook_type === 'telegram') {
    return tokenOf(settings) ? `https://api.telegram.org/bot${tokenOf(settings)}/sendMessage` : '';
  }
  return settings.webhook_url || '';
}

function payloadFor(settings, title, message, level, nowSeconds) {
  if (settings.webhook_type === 'pushplus') {
    return {
      token: tokenOf(settings),
      title,
      content: message,
      template: 'txt',
    };
  }
  if (settings.webhook_type === 'bark') return { title, body: message, level };
  if (settings.webhook_type === 'telegram') return { chat_id: settings.notify_target || '', text: text(title, message) };
  if (settings.webhook_type === 'feishu') return { msg_type: 'text', content: { text: text(title, message) } };
  if (settings.webhook_type === 'wecom') return { msgtype: 'text', text: { content: text(title, message) } };
  if (settings.webhook_type === 'dingtalk') return { msgtype: 'text', text: { content: text(title, message) } };
  if (settings.webhook_type === 'slack') return { text: text(title, message) };
  if (settings.webhook_type === 'discord') return { content: text(title, message) };
  if (settings.webhook_type === 'custom' && settings.webhook_template) {
    const timestamp = nowSeconds();
    return {
      title,
      message: renderTemplate(settings.webhook_template, { title, message, level, timestamp }),
      level,
      timestamp,
    };
  }
  return { title, message, level, timestamp: nowSeconds() };
}

export class Notifier {
  constructor(settings, fetcher = (input, init) => globalThis.fetch(input, init), nowSeconds = () => Math.floor(Date.now() / 1000)) {
    this.settings = settings;
    this.fetcher = fetcher;
    this.nowSeconds = nowSeconds;
  }

  async send(title, message, level = 'info') {
    const url = urlFor(this.settings);
    if (!url) return { ok: false, skipped: true };
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...parseJsonObject(this.settings.webhook_headers) },
        body: JSON.stringify(payloadFor(this.settings, title, message, level, this.nowSeconds)),
      });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
}
