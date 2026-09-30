# Clash-Rules [![规则备份](https://img.shields.io/github/actions/workflow/status/ningjx/Clash-Rules/update-rules.yml?label=rule%20backup)](https://github.com/ningjx/Clash-Rules/actions/workflows/update-rules.yml)

供 Mihomo、OpenClash 和 Clash Verge Rev 使用的分流模板。规则先匹配个人指定的域名和服务，再由通用规则处理其余流量。项目也提供一个将服务商订阅接入模板的 Cloudflare Worker。

## 直接使用

打开 **[在线配置生成器](https://ning.host/clash)**，填入服务商订阅地址，生成完整的 Mihomo 配置。OpenClash 也可以把 `https://ning.host/clash` 填为在线订阅转换服务地址。Worker 只把订阅地址写入 `proxy-providers`，节点由客户端自行更新；详细参数见 [Worker V2 说明](server/cf-worker-v2/README.md)。

[ClashConfigTemp.yaml](ClashConfigTemp.yaml) 是含有 `{ProxyList}`、`{ProxiesNames}` 等占位符的原始模板，**不能直接导入客户端**。OpenClash 会按自身设置覆写部分运行参数；其他客户端可按需调整端口、TUN 和控制接口。

## 分流顺序

Mihomo 从上到下匹配规则，先命中的规则决定策略。当前模板的主要顺序是：

| 优先级 | 规则 | 用途 |
| --- | --- | --- |
| 1 | `CustomProxy`、`CustomDirect` | 手动指定代理或直连 |
| 2 | blackmatrix7 域名／进程规则 | Netflix、YouTube、OpenAI 等服务单独选策略 |
| 3 | blackmatrix7 IP 规则 | 只匹配已有目标 IP，不为匹配规则额外触发 DNS 查询 |
| 4 | Loyalsoldier 通用规则 | 应用、私有网络及明确直连或代理的域名 |
| 5 | MetaCubeX 域名与 IP 规则 | 中国／非中国域名分流，中国 IP 兜底 |
| 6 | `MATCH` | 交给“未知流量”策略组 |

`rules/local_rules/Streaming.yaml` 已停用，仅作备份。`rules/gen_loyalsoldier/` 中未被模板引用的旧文件也不会自动更新。

## 文件在哪

| 路径 | 用途 |
| --- | --- |
| [ClashConfigTemp.yaml](ClashConfigTemp.yaml) | DNS、策略组、规则顺序和 Provider 地址 |
| [rules/local_rules/](rules/local_rules) | 手动维护的代理与直连例外 |
| [rules/gen_blackmatrix7/](rules/gen_blackmatrix7) | 来自 [blackmatrix7](https://github.com/blackmatrix7/ios_rule_script) 的服务细分规则；`服务名.yaml` 为域名／进程规则，`服务名_IP.yaml` 为目标 IP 规则 |
| [rules/gen_loyalsoldier/](rules/gen_loyalsoldier) | 来自 [Loyalsoldier](https://github.com/Loyalsoldier/clash-rules) 的通用规则 |
| [rules/gen_metacubex/](rules/gen_metacubex) | 来自 [MetaCubeX](https://github.com/MetaCubeX/meta-rules-dat) 的 MRS 规则备份 |
| [configs/](configs) | 上游规则来源及服务策略组配置 |

模板中的规则 Provider 都从本仓库读取文件。上游规则每天由 [GitHub Actions](.github/workflows/update-rules.yml) 备份一次；下载或校验失败时保留已有的有效文件，缺少有效备份则让工作流失败。

服务规则统一从上游 Clash `.list` 读取，再由 Python 按规则类型拆分；这样多来源的 Microsoft 和其他服务采用同一流程，也能在上游新增 IP 规则时自动生成对应备份与引用。纯 CIDR 备份使用 `ipcidr`，含 `IP-ASN` 等规则的备份使用 `classical`。服务 IP 规则使用 `no-resolve`，因此域名请求若只靠 IP 才能识别服务，可能落入后续通用规则；这是避免服务规则提前触发 DNS 解析的取舍。

## 修改规则

- **指定域名走向：**编辑 [CustomProxy.yaml](rules/local_rules/CustomProxy.yaml) 或 [CustomDirect.yaml](rules/local_rules/CustomDirect.yaml)。它们排在通用规则前面。
- **添加或调整服务策略组：**编辑 [config_blackmatrix7.yml](configs/config_blackmatrix7.yml)，由 Python 脚本重建对应规则文件和模板中的自动生成区块。
- **调整通用备份清单：**编辑 [rule_sources.yml](configs/rule_sources.yml)，并同步修改模板里的 Provider 引用。
- **调整分流优先级或 DNS：**编辑 [ClashConfigTemp.yaml](ClashConfigTemp.yaml)。

本地校验或更新备份：

```powershell
python -m pip install -r scripts/requirements.txt
python -m unittest discover -s tests -p test_rules.py
python scripts/update_rules.py --offline  # 只校验现有备份
python scripts/update_rules.py            # 从上游更新
```

## 其他转换服务

仓库还保留了 JustMySocks 专用的 [Cloudflare Worker](server/worker/README.md)、[Vercel](server/vercel/README.md) 和 [阿里云 ESA](server/aliyunesa/README.md) 实现。它们与上面的通用订阅转换 Worker 是不同的服务，使用方法见各自文档。
