# Clash-Rules [![Rule backup](https://img.shields.io/github/actions/workflow/status/ningjx/Clash-Rules/update-rules.yml?label=rule%20backup)](https://github.com/ningjx/Clash-Rules/actions/workflows/update-rules.yml)

Clash配置规则集合与JustMySocks订阅转换工具集。本项目整合了多个公开规则源，并提供了跨平台云端部署的订阅转换服务，用于自动将代理配置转换为Clash兼容格式。

## 项目概述

这是一个综合性的Clash规则和工具项目，包含两大功能模块：

1. **规则集合模块**：集成多个优质规则源，实时更新各类应用和服务的代理规则
2. **订阅转换服务**：提供JustMySocks账户订阅转换为Clash配置的API服务，支持多种云端部署方式

## 项目结构与功能说明

### 📋 核心配置文件

#### [ClashConfigTemp.yaml](ClashConfigTemp.yaml)
Clash配置模板文件，定义了Clash的基础配置结构和策略组定义。包含：
- 混合代理端口和本机监听默认值；OpenClash 等客户端可覆写运行时端口
- DNS配置（节点域名专用解析、国内外 DNS 回退、Fake-IP 设置）
- 日志设置；控制接口由客户端按自身环境配置
- 代理策略组模板（快速测试、负载均衡等）
- 代理路由规则模板（通过占位符如`{ProxyList}`、`{ProxiesNames}`等填充）

模板中的占位符需要先由转换服务填充，不能把原始模板直接导入客户端。生成后的完整配置可交给 Mihomo 内核、OpenClash 或 Clash Verge Rev 使用；端口、控制接口和 TUN 等客户端运行参数由客户端按需覆写。

`dns.fake-ip-filter` 保留跨客户端的基础例外及原模板中不属于 OpenClash 自带列表的自定义域名（如 `time.is`、国内 NTP、音乐和米家域名）。OpenClash 的自定义 Fake-IP 过滤列表需要在插件中启用才会合并；其他设备和应用专用例外请在所用客户端按需添加。

### 📁 文件夹说明

#### 1. [gen_blackmatrix7/](gen_blackmatrix7) - 指定服务规则集
包含来自 [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) 项目的各类服务规则文件。这些是针对特定应用和平台的详细规则，用于精确控制各服务的流量转发。

**文件列表**（YAML格式，包含域名和IP段规则）:
- `Netflix.yaml` - Netflix流媒体服务规则
- `YouTube.yaml` - YouTube视频平台规则
- `Disney.yaml` - Disney+流媒体规则
- `TikTok.yaml` - TikTok短视频平台规则
- `Telegram.yaml` - Telegram即时通讯规则
- `Google.yaml` - Google服务规则
- `Microsoft.yaml` - 微软服务规则
- `Amazon​PrimeVideo.yaml` - Amazon Prime Video流媒体规则
- `Hulu.yaml` - Hulu流媒体规则
- `OpenAI.yaml`、`Claude.yaml` - AI 服务规则

**特点**:
- 自动化生成：通过GitHub Actions读取 [configs/config_blackmatrix7.yml](configs/config_blackmatrix7.yml) 配置文件自动更新
- 配置驱动：在配置文件中定义规则源URL、名称和默认代理，即可自动生成对应的规则文件
- 灵活管理：修改配置文件可轻松添加、删除或调整指定服务规则

#### 2. [gen_loyalsoldier/](gen_loyalsoldier) - 总体分流规则集
包含来自 [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) 项目的通用规则文件。这是作为总体分流基础的规则集，用于将流量分类为不同的路由策略（代理、直连、拒绝等）。

**模板实际引用且每日更新的文件**（扩展名为 `.txt`，内容为 `payload:` YAML）：
- `direct.txt` - 直连列表（国内主要网站）
- `cncidr.txt` - 中国IP段CIDR列表
- `lancidr.txt` - 局域网IP段列表
- `apple.txt` - Apple相关服务
- `icloud.txt` - iCloud相关服务
- `proxy.txt` - 代理工具相关网站
- `applications.txt` - 应用程序相关域名
- `private.txt` - 私有IP段

目录中的其他旧文件保留作历史备份，不再由工作流更新，也不在当前模板中加载。

**特点**：
- 作为总体分流的基础规则，优先级较低
- 定期自动更新，覆盖主流应用和网络基础设施

#### 3. [gen_metacubex/](gen_metacubex) - MetaCubeX MRS 备份
备份当前模板引用的 `cn`、`geolocation-!cn` 域名集及 `cn` IP 集。模板通过本仓库地址加载这些 MRS 文件；上游同步失败时保留已有有效备份。

#### 4. [local_rules/](local_rules) - 本地自定义规则
项目维护的自定义规则，补充和优化来自其他源的规则。

**文件列表**（YAML格式）：
- `CustomProxy.yaml` - 自定义代理规则（GitHub、Z-Library、platformio等常用工具和服务）
- `CustomDirect.yaml` - 自定义直连规则（国内服务和本地服务）
- `Streaming.yaml` - 已停用的流媒体规则备份，当前模板不加载

**用途**：
- 补充开源规则中缺失的域名
- 修正错误的分类规则
- 添加用户特定需求的域名
- 与其他规则源的冲突解决

#### 5. [vercel/](vercel) - Vercel云端部署方案
使用Vercel Serverless Functions部署的JustMySocks订阅转换服务。详见：[vercel/README.md](vercel/README.md)

#### 6. [aliyunesa/](aliyunesa) - 阿里云ESA边缘计算方案
使用阿里云ESA(Edge Serverless Application)部署的JustMySocks订阅转换服务。详见：[aliyunesa/README.md](aliyunesa/README.md)

#### 7. [worker/](worker) - Cloudflare Workers方案
使用Cloudflare Workers部署的JustMySocks订阅转换服务。详见：[worker/README.md](worker/README.md)

## 业务逻辑说明

### 规则处理流程

`configs/config_blackmatrix7.yml` 定义需要合并的服务细分规则及其策略组默认选项；`configs/rule_sources.yml` 列出模板引用的 Loyalsoldier 与 MetaCubeX 上游文件。每日运行的 `.github/workflows/update-rules.yml` 调用 `scripts/update_rules.py`，把三类规则备份到 `gen_blackmatrix7/`、`gen_loyalsoldier/`、`gen_metacubex/`，并重建模板中标记的三个自动生成区块。

脚本按文件校验下载结果。一个 blackmatrix7 规则由多个来源合并时，必须全部下载成功，才会替换本仓库的备份；上游失效时继续使用已有且有效的备份。缺少有效备份则使工作流失败，不会提交空文件。所有规则 Provider 都指向本仓库，模板里的优先级依次为自定义规则、服务细分规则、明确直连/代理规则、中国域名和非中国域名、IP 兜底。

本地运行：

```powershell
python -m pip install -r scripts/requirements.txt
python -m unittest discover -s tests -p test_rules.py
python scripts/update_rules.py --offline  # 只校验现有备份并重建模板
python scripts/update_rules.py            # 从上游刷新备份
```

**配置文件格式说明**（configs/config_blackmatrix7.yml）：
```yaml
mirror_site: https://mirror.ning.host          # 镜像站点用于加速URL访问
rules:
  - name: Microsoft                             # 规则名称
    urls:                                       # 规则源URLs（支持多个）
      - https://raw.githubusercontent.com/...
      - https://raw.githubusercontent.com/...
    default_proxy: DIRECT                       # 可选：默认代理（优先级最高）
  - name: YouTube
    urls:
      - https://raw.githubusercontent.com/...
    # 不指定default_proxy则使用默认代理顺序
```

**规则加载顺序说明**：
- 指定服务规则（gen_blackmatrix7）优先级高，精确匹配特定应用
- 本仓库备份的 Loyalsoldier 和 MetaCubeX 规则作为大范围分流基础
- 本地自定义规则可补充和修正两种规则集的遗漏或冲突

### 订阅转换流程

```
JustMySocks账户信息
    ↓
API请求参数解析 (service, id, useDomain等)
    ↓
并行获取数据
    ├─→ 流量查询 (BW统计API)
    ├─→ 代理配置 (Base64编码的SS/VMess)
    └─→ Clash模板 (ClashConfigTemp.yaml)
    ↓
数据处理
    ├─→ Base64解码
    ├─→ 代理协议解析 (SS → Clash, VMess → Clash)
    ├─→ 代理名称映射 (c6s1→美国1, c6s4→日本等)
    └─→ 流量信息计算 (1024→1000进制转换, 过期日期计算)
    ↓
配置生成
    ├─→ YAML格式转换
    ├─→ 模板占位符替换 ({ProxyList}, {ProxiesNames}等)
    └─→ 代理组生成 (快速测试, 负载均衡等)
    ↓
动态文件名生成 (UTC+8时区)
    ↓
返回Clash配置文件 (可直接导入)
```

## 使用方法

### 1. 获取Clash规则

#### 方法A：直接使用本项目的规则文件

在Clash配置中添加规则提供者：

```yaml
rule-providers:
  # 黑名单规则（需代理的网站）
  netflix:
    type: http
    url: https://raw.githubusercontent.com/ningjx/Clash-Rules/master/gen_blackmatrix7/Netflix.yaml
    interval: 86400

  # 白名单规则（直连网站）
  gfw:
    type: http
    url: https://raw.githubusercontent.com/ningjx/Clash-Rules/master/gen_loyalsoldier/gfw.txt
    interval: 86400

  # 自定义规则
  custom-proxy:
    type: http
    url: https://raw.githubusercontent.com/ningjx/Clash-Rules/master/local_rules/CustomProxy.yaml
    interval: 86400
```

#### 方法B：使用完整Clash配置（推荐）

使用订阅转换服务获取包含所有规则和代理的完整配置。见下文。

### 2. 使用订阅转换服务

#### 获取完整的Clash配置

三种部署方案均提供相同的API接口，选择任一方案即可：

**请求格式**：
```
GET /justmysocks?service=SERVICE_ID&id=SUBSCRIPTION_GUID&useDomain=true
```

**参数说明**：
- `service` (必需)：JustMySocks服务ID（8位数字）
- `id` (必需)：订阅GUID
- `useDomain` (可选)：是否使用域名，默认true
- `track` (可选)：追踪ID

**响应**：
- 直接返回Clash配置文件（.yaml格式）
- 文件名自动生成：`ClashConfig-YYYY-MM-DD-HH-MM-SS.yaml`
- 响应头包含流量信息：`Subscription-Userinfo`

**配置导入**：
1. 获取配置文件URL
2. 在Clash应用中导入配置
3. 自动关联所有规则和代理

### 3. 部署方案选择

| 指标 | Vercel | ESA | Workers |
|-----|--------|-----|---------|
| 全球访问速度 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 国内访问速度 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 部署难度 | 简单 | 中等 | 简单 |
| 免费额度 | 充足 | 充足 | 充足 |
| DDoS防护 | ✗ | ✗ | ✓✓✓ |

**推荐选择**：
- 国际用户优先：**Cloudflare Workers**
- 快速部署：**Vercel**

### 4. 自定义使用

#### 添加自定义规则

1. 修改或创建 [local_rules/](local_rules) 下的yaml文件
2. 按照Clash规则格式添加payload

#### 修改Clash配置模板

编辑 [ClashConfigTemp.yaml](ClashConfigTemp.yaml) 来自定义：
- DNS配置
- 端口设置
- 代理策略组
- 规则路由

## 更新周期

- **当前模板引用的 blackmatrix7、Loyalsoldier 和 MetaCubeX 规则**：同一个工作流每日更新一次
- **本地规则**：手动维护
- **规则缓存**：建议设置为86400秒（每日）

## 常见问题

**Q: 规则文件什么时候更新？**
A: GitHub Actions每日定时自动更新blackmatrix7和loyalsoldier的规则，查看Actions标签可看到最新更新时间。

**Q: gen_blackmatrix7和gen_loyalsoldier有什么区别？**
A: 两者都是规则集，功能不同：
- gen_blackmatrix7：指定服务的精细规则，每个文件针对一个具体应用（如Netflix、YouTube），规则数量多、覆盖详细，优先级高
- gen_loyalsoldier：总体分流的基础规则，包含通用的代理/直连/拦截列表，优先级低
- 推荐组合使用：先用gen_blackmatrix7精确控制已知服务，再用gen_loyalsoldier处理其他流量
- 管理方式：通过编辑 [configs/config_blackmatrix7.yml](configs/config_blackmatrix7.yml) 来添加、删除或调整指定的服务规则

**Q: 如何选择合适的部署方案？**
A: 建议使用Cloudflare Workers，或者Vercel。

**Q: 流量信息在哪里看？**
A: 导入配置后，在代理应用中查看Subscription-Userinfo响应头的流量信息（使用量/总量）。

**Q: 支持其他协议吗？**
A: 目前支持SS和VMess协议。其他协议支持需要扩展代码。

## 相关链接

- [blackmatrix7规则项目](https://github.com/blackmatrix7/ios_rule_script)
- [Loyalsoldier规则项目](https://github.com/Loyalsoldier/clash-rules)
