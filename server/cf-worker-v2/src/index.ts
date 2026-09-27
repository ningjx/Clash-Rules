import YAML from 'yaml';
import page from './page.html';
import bundledTemplate from './template.yaml';

const TEMPLATE_URL = 'https://raw.githubusercontent.com/ningjx/Clash-Rules/refs/heads/master/ClashConfigTemp.yaml';
const MARKER = '__CLASH_PROVIDER_ALL__';
const MAX_TEMPLATE_BYTES = 512_000;
const MAX_INPUT_LENGTH = 16_384;

type Env = Record<string, never>;
type Plain = Record<string, unknown>;

interface Subscription { name: string; url: string }

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function isObject(value: unknown): value is Plain {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) fail(`参数必须为 ${min}–${max} 之间的整数`);
  return value;
}

function validatePattern(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (raw.length > 500) fail('筛选表达式过长');
  try { new RegExp(raw); } catch { fail('筛选表达式不是有效正则'); }
  return raw;
}

function subscriptionUrl(raw: string): string {
  if (raw.length > MAX_INPUT_LENGTH) fail('订阅地址过长');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail('订阅地址无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    fail('订阅必须是 HTTP/HTTPS 地址，且不能含 URL 用户信息');
  }
  return raw;
}

function parseSubscriptions(raw: string): Subscription[] {
  if (!raw || raw.length > MAX_INPUT_LENGTH) fail('请输入有效订阅地址');
  const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 8) fail('一次支持 1–8 个订阅');
  const used = new Set<string>();
  return parts.map((part, index) => {
    let name = `订阅${index + 1}`;
    let address = part;
    const named = /^provider:([^,]{1,48}),(https?:\/\/.*)$/i.exec(part);
    if (named) { name = named[1].trim(); address = named[2]; }
    if (!name || /[\r\n\x00-\x1f]/.test(name)) fail('Provider 名称无效');
    subscriptionUrl(address);
    const base = name;
    for (let suffix = 2; used.has(name); suffix++) name = `${base}-${suffix}`;
    used.add(name);
    return { name, url: address };
  });
}

function prepareTemplate(source: string): Plain {
  if (!/^proxies:\s*$/m.test(source)) fail('模板缺少 proxies 段', 422);
  if (!source.includes('{ProxiesNames}') || !source.includes('{BalanceProxiesNames}')) fail('模板缺少节点占位符', 422);
  const prepared = source
    .replace(/^\{ProxyList\}\s*$/gm, '')
    .replace(/^\{(?:ProxiesNames|BalanceProxiesNames)\}\s*$/gm, `      - ${MARKER}`);
  let parsed: unknown;
  try { parsed = YAML.parse(prepared, { uniqueKeys: true }); } catch { fail('公共模板 YAML 解析失败', 422); }
  if (!isObject(parsed) || !Array.isArray(parsed['proxy-groups']) || !Array.isArray(parsed.rules) || !isObject(parsed['rule-providers'])) {
    fail('公共模板结构不完整', 422);
  }
  return parsed;
}

function compile(source: string, subscriptions: Subscription[], options: { include?: string; exclude?: string; interval?: number; providerProxy?: string } = {}): string {
  const config = prepareTemplate(source);
  config.proxies = [];
  const providers: Plain = {};
  subscriptions.forEach(({ name, url }, index) => {
    const provider: Plain = {
      type: 'http', url, path: `./proxy_providers/provider_${index + 1}.yaml`,
      interval: options.interval ?? 3600,
      proxy: options.providerProxy ?? 'DIRECT',
      'health-check': { enable: true, url: 'https://www.gstatic.com/generate_204', interval: 300 },
    };
    if (options.include) provider.filter = options.include;
    if (options.exclude) provider['exclude-filter'] = options.exclude;
    providers[name] = provider;
  });
  config['proxy-providers'] = providers;
  let modified = 0;
  const groupTypes = new Set(['select', 'url-test', 'fallback', 'load-balance', 'relay']);
  for (const group of config['proxy-groups'] as unknown[]) {
    if (!isObject(group) || !Array.isArray(group.proxies)) fail('公共模板策略组无效', 422);
    if (typeof group.type !== 'string' || !groupTypes.has(group.type)) fail('公共模板策略组类型无效', 422);
    const entries = group.proxies as unknown[];
    if (!entries.includes(MARKER)) continue;
    group.proxies = entries.filter(x => x !== MARKER);
    group.use = subscriptions.map(x => x.name);
    modified++;
  }
  if (!modified) fail('公共模板未找到节点策略组', 422);
  return YAML.stringify(config, { lineWidth: 0 });
}

async function loadTemplate(): Promise<string> {
  let response: Response;
  try { response = await fetch(TEMPLATE_URL, { redirect: 'error', headers: { Accept: 'text/plain' }, signal: AbortSignal.timeout(4000) }); }
  catch { return bundledTemplate; }
  if (!response.ok) return bundledTemplate;
  const reported = Number(response.headers.get('content-length'));
  if (reported > MAX_TEMPLATE_BYTES) fail('公共模板过大', 502);
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_TEMPLATE_BYTES) fail('公共模板过大', 502);
  return text;
}

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
    if (path === '/clash/version') {
      return new Response('Clash Provider Worker backend version 1.0.0', {
        headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (path === '/clash' || path === '/clash/') {
      if (!url.searchParams.has('url')) return new Response(page, { headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" } });
    } else if (path !== '/clash/sub' && path !== '/sub' && !path.startsWith('/clash/http://') && !path.startsWith('/clash/https://')) {
      return new Response('Not Found', { status: 404 });
    }
    try {
      if (url.search.length > MAX_INPUT_LENGTH + 2048) fail('请求参数过长');
      const direct = path.startsWith('/clash/http://') || path.startsWith('/clash/https://');
      const params = direct ? new URLSearchParams() : url.searchParams;
      const target = params.get('target') ?? 'clash';
      if (target !== 'clash') fail('只支持 target=clash', 422);
      if (params.get('list')?.toLowerCase() === 'true') fail('Provider 模式不支持 list=true', 422);
      const raw = direct ? decodeURIComponent(path.slice('/clash/'.length)) + url.search : (url.searchParams.get('url') ?? '');
      const subscriptions = parseSubscriptions(raw);
      const include = validatePattern(params.get('include'));
      const exclude = validatePattern(params.get('exclude'));
      const interval = positiveInteger(params.get('interval'), 3600, 300, 86400);
      const providerProxy = params.get('provider_proxy') ?? 'DIRECT';
      if (providerProxy !== 'DIRECT') fail('provider_proxy 目前只支持 DIRECT');
      const template = await loadTemplate();
      const output = compile(template, subscriptions, { include, exclude, interval, providerProxy });
      if (params.get('explain') === 'true') return json({ mode: 'mihomo-proxy-provider', providers: subscriptions.length, groups: YAML.parse(output)['proxy-groups'].length, remote_subscription_fetch: false, template: TEMPLATE_URL });
      return new Response(output, { headers: { ...privateHeaders, 'Content-Type': 'application/yaml; charset=utf-8', 'Content-Disposition': 'attachment; filename="clash-provider.yaml"' } });
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400;
      const message = error instanceof Error ? error.message : '处理失败';
      return json({ error: message }, status >= 400 && status < 600 ? status : 500);
    }
  },
};
