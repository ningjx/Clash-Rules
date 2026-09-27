# Clash ProxyProvider Worker

这个目录是一个独立的 Cloudflare Worker 项目，供 Cloudflare Workers Builds 直接连接本仓库部署。它使用仓库根目录的 `ClashConfigTemp.yaml` 对应的固定公共模板，将服务商订阅地址写入 Mihomo `proxy-providers`；Worker 不下载服务商配置或节点。

## Cloudflare Git 集成

- 仓库：`ningjx/Clash-Rules`
- 生产分支：`master`
- Root directory：`server/cf-worker-v2`
- Build command：留空
- Deploy command：`npx wrangler deploy`（默认值）
- Worker 名称：`clash-converter`，需与 `wrangler.jsonc` 的 `name` 一致
- 路由：`ning.host/clash*`，由 `wrangler.jsonc` 配置

无需 GitHub Actions 工作流。将本目录提交并推送到连接的分支后，Cloudflare 的 Git 集成会自动构建和部署。该 Worker 的路由会接管 `ning.host/clash*`，请确认现有路由没有冲突。

## 入口

1. `https://ning.host/clash/https://provider.example/sub?token=...`：直接获取 YAML。
2. 在 OpenClash 的在线订阅转换服务地址填写 `https://ning.host/clash`；支持 `/clash?target=clash&url=...` 和 `/clash/sub?target=clash&url=...`。
3. 浏览器打开 `https://ning.host/clash`，输入一个或多个服务商订阅地址生成配置或链接。

`url` 可用 `|` 分隔最多 8 个订阅，也可使用 `provider:名称,https://...`。`include` 和 `exclude` 映射为 Mihomo Provider 正则筛选；`interval` 可设置为 300–86400 秒。`explain=true` 返回脱敏诊断 JSON。`list=true` 会被拒绝。OpenClash 传来的 `config` 参数不改变固定模板。

三份参考 YAML 包含 TUIC、VLESS、AnyTLS、Trojan、Hysteria2、VMess、SS 节点。本 Worker 不解析或重写节点及其扩展字段，由用户设备上的 Mihomo 读取原订阅中的 `proxies`。服务商自带的 DNS、策略组和规则不会合并，主配置使用统一模板。特殊私有格式仍需服务商提供 Mihomo 可解析的订阅。

## 本地验证

```powershell
npm ci
npm run check
npm run dev
```

`src/template.yaml` 是仓库根目录模板的随包快照；运行时先读取固定的 GitHub Raw 模板，读取失败时使用此快照。根目录模板变更后，应同步更新快照。
