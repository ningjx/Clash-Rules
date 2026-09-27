const SUB_URL = "https://jmssub.net/members/getsub.php";
const BW_URL = "https://justmysocks3.net/members/getbwcounter.php";
const TEMPLATE_URL =
  "https://raw.githubusercontent.com/ningjx/Clash-Rules/refs/heads/master/ClashConfigTemp.yaml";
const MAX_YAML_SIZE = 2 * 1024 * 1024;

const NAME_MAPPING = {
  c6s1: "美国1",
  c6s2: "美国2",
  c6s3: "美国3",
  c6s4: "日本",
  c6s5: "荷兰",
  c6s801: "美国0.1倍流量",
};
const BALANCE_CODES = new Set(["c6s1", "c6s2", "c6s3"]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

async function readText(response, maxSize, label) {
  if (!response.ok) throw new HttpError(502, `${label}请求失败: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxSize) {
    throw new HttpError(502, `${label}内容过大`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSize) {
        await reader.cancel();
        throw new HttpError(502, `${label}内容过大`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchText(url, label, maxSize = MAX_YAML_SIZE) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new HttpError(502, `${label}请求失败`);
  }
  return readText(response, maxSize, label);
}

function scalarValue(value) {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replaceAll("''", "'");
  }
  return text;
}

function fieldFromBlock(lines, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(`^\\s*(?:-\\s*)?${escaped}\\s*:\\s*(.+?)\\s*$`);
  const flowPattern = new RegExp(
    `\\b${escaped}\\s*:\\s*("(?:\\\\.|[^"])*"|'(?:''|[^'])*'|[^,}]+)`,
  );
  for (const line of lines) {
    const match = line.match(blockPattern) || line.match(flowPattern);
    if (match) return scalarValue(match[1]);
  }
  return null;
}

function renameProxy(lines, name) {
  const blockPattern = /^(\s*(?:-\s*)?name\s*:\s*)(.+?)\s*$/;
  const flowPattern = /(\bname\s*:\s*)("(?:\\.|[^"])*"|'(?:''|[^'])*'|[^,}]+)/;

  for (let i = 0; i < lines.length; i += 1) {
    if (blockPattern.test(lines[i])) {
      lines[i] = lines[i].replace(blockPattern, `$1${JSON.stringify(name)}`);
      return true;
    }
    if (flowPattern.test(lines[i])) {
      lines[i] = lines[i].replace(flowPattern, `$1${JSON.stringify(name)}`);
      return true;
    }
  }
  return false;
}

function extractProxyBlocks(yaml) {
  const lines = yaml.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^proxies\s*:\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new HttpError(502, "上游配置中没有proxies");

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z0-9_-]+\s*:/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  const firstItem = body.find((line) => /^(\s*)-\s+/.test(line));
  if (!firstItem) throw new HttpError(502, "上游配置中没有有效代理");
  const itemIndent = firstItem.match(/^(\s*)-/)[1].length;
  const itemPattern = new RegExp(`^\\s{${itemIndent}}-\\s+`);
  const blocks = [];
  let current = null;

  for (const line of body) {
    if (itemPattern.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

export function transformClashConfig(upstreamYaml, template) {
  for (const token of ["{ProxyList}", "{ProxiesNames}", "{BalanceProxiesNames}"]) {
    if (!template.includes(token)) throw new HttpError(502, "GitHub模板缺少必要占位符");
  }

  const usedNames = new Map();
  const proxyBlocks = [];
  const proxyNames = [];
  const balanceNames = [];

  for (const sourceLines of extractProxyBlocks(upstreamYaml)) {
    const lines = [...sourceLines];
    if (fieldFromBlock(lines, "server") === "0.0.0.0") continue;

    const oldName = fieldFromBlock(lines, "name");
    if (!oldName) continue;
    const code = /@([^.@:]+)\./.exec(oldName)?.[1]?.toLowerCase() ?? null;
    const baseName = NAME_MAPPING[code] ?? oldName;
    const count = (usedNames.get(baseName) ?? 0) + 1;
    usedNames.set(baseName, count);
    const newName = count === 1 ? baseName : `${baseName}-${count}`;
    if (!renameProxy(lines, newName)) continue;

    while (lines.length && !lines.at(-1).trim()) lines.pop();
    proxyBlocks.push(lines.join("\n"));
    proxyNames.push(newName);
    if (BALANCE_CODES.has(code)) balanceNames.push(newName);
  }

  if (!proxyBlocks.length) throw new HttpError(502, "上游配置中没有有效代理");
  const nameLines = (names) => names.map((name) => `      - ${JSON.stringify(name)}`).join("\n");
  return template
    .replaceAll("{ProxyList}", proxyBlocks.join("\n"))
    .replaceAll("{ProxiesNames}", nameLines(proxyNames))
    .replaceAll("{BalanceProxiesNames}", nameLines(balanceNames));
}

function subscriptionUserinfo(data) {
  const used = Number(data?.bw_counter_b);
  const total = Number(data?.monthly_bw_limit_b);
  const resetDay = Number(data?.bw_reset_day_of_month);
  if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isInteger(resetDay)) return null;

  const now = new Date();
  let month = now.getUTCMonth();
  let year = now.getUTCFullYear();
  if (now.getUTCDate() > resetDay) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  const expire = Math.floor(Date.UTC(year, month, resetDay, 7) / 1000);
  return `upload=0; download=${Math.round(used * 1.073741824)}; total=${Math.round(total * 1.073741824)}; expire=${expire}`;
}

async function getBandwidth(url) {
  try {
    const text = await fetchText(url, "流量接口", 64 * 1024);
    return subscriptionUserinfo(JSON.parse(text));
  } catch {
    return null;
  }
}

function filename() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `ClashConfig-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}.yaml`;
}

export default {
  async fetch(request) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    if (url.pathname.toLowerCase() !== "/justmysocks") {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const service = url.searchParams.get("service")?.trim();
    const id = url.searchParams.get("id")?.trim();
    if (!service || !id) {
      return new Response("Missing required parameters: service and id", { status: 400 });
    }

    const useDomainValue =
      url.searchParams.get("useDomain") ??
      url.searchParams.get("usedomain") ??
      url.searchParams.get("usedomains");
    const usedomains = /^(?:false|0)$/i.test(useDomainValue ?? "") ? "0" : "1";

    const subUrl = new URL(SUB_URL);
    subUrl.searchParams.set("service", service);
    subUrl.searchParams.set("id", id);
    subUrl.searchParams.set("format", "clash");
    subUrl.searchParams.set("usedomains", usedomains);

    const bwUrl = new URL(BW_URL);
    bwUrl.searchParams.set("service", service);
    bwUrl.searchParams.set("id", id);

    try {
      const [upstreamYaml, template, userinfo] = await Promise.all([
        fetchText(subUrl, "订阅接口"),
        fetchText(TEMPLATE_URL, "GitHub模板"),
        getBandwidth(bwUrl),
      ]);
      const config = transformClashConfig(upstreamYaml, template);
      console.log(JSON.stringify({ message: "配置生成成功", requestId, durationMs: Date.now() - startedAt }));

      const headers = {
        ...corsHeaders(),
        "Content-Type": "application/x-yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename()}"`,
        "Cache-Control": "no-store",
      };
      if (userinfo) headers["Subscription-Userinfo"] = userinfo;
      return new Response(config, { headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(JSON.stringify({ message: "配置生成失败", requestId, status }));
      return Response.json(
        { success: false, error: error instanceof HttpError ? error.message : "Internal Server Error" },
        { status, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
      );
    }
  },
};
