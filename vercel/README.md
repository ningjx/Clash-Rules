# JustMySocks Clash 配置生成器

## 概述

这个Vercel函数提供了一个API服务，用于将JustMySocks账户的代理配置转换为Clash兼容格式的配置文件。它支持自动解析、格式转换，并生成可直接导入的Clash配置文件。

## 使用方法

### 请求格式

```
GET /justmysocks?service=SERVICE_ID&id=SUBSCRIPTION_ID&useDomain=true&track=TRACK_ID
```

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `service` | string | ✓ | JustMySocks服务ID（格式：8位数字如0000000） |
| `id` | string | ✓ | 订阅GUID标识符 |
| `useDomain` | boolean | ✗ | 是否使用域名代替IP地址。可选值：`true`（默认）或`false` |
| `track` | string | ✗ | 追踪标识符，用于请求追踪（可选） |

### 请求示例

```
https://your-vercel-domain.com/api/justmysocks?service=0000000&id=guid-string&useDomain=true
```

### 响应

- **成功响应**：返回YAML格式的Clash配置文件，包含所有解析的代理节点
- **文件下载**：响应包含`Content-Disposition`头，文件名格式为 `ClashConfig-YYYY-MM-DD-HH-MM-SS.yaml`
- **流量信息**：通过`Subscription-Userinfo`响应头返回流量使用统计信息

## 技术细节

### 工作流程

1. **请求验证**
   - 验证请求路径是否为 `/api/justmysocks`
   - 检查必需参数 `service` 和 `id`

2. **并行网络请求**
   - 同时发起三个HTTP请求：
     - **流量查询**：从JustMySocks获取账户流量信息
     - **上游代理**：从jmssub.net获取Base64编码的代理配置
     - **Clash模板**：从GitHub获取Clash配置模板

3. **流量信息处理**
   - 解析JSON格式的流量数据（字节单位）
   - 自动计算流量重置日期（基于`bw_reset_day_of_month`）
   - 1024进制转1000进制换算（乘以1.073741824）
   - 生成RFC标准的`Subscription-Userinfo`头

4. **代理配置解析**
   - Base64解码上游响应
   - 逐行解析两种代理协议：
     - **Shadowsocks (ss://)**：提取加密方式、密码、服务器、端口
     - **VMess**：提取UUID、加密方式、服务器信息等
   - 从服务器标识符自动识别节点位置

5. **代理名称映射**
   - 根据预设映射表将技术标识符转换为中文名称
   - 映射表示例：
     - `c6s1` → 美国1
     - `c6s4` → 日本
     - `c6s5` → 荷兰

6. **Clash配置生成**
   - 将解析的代理配置转换为YAML格式
   - 替换模板中的占位符：
     - `{ProxyList}`：所有代理节点
     - `{ProxiesNames}`：代理名称列表
     - `{FastestProxiesNames}`：快速测试代理列表（排除高倍率节点）
     - `{BalanceProxiesNames}`：负载均衡代理列表（美国/s1/s2/s3节点）

### 主要特性

- **高效处理**：使用Promise.all并行化三个网络请求
- **性能监控**：详细的时间戳记录各处理阶段耗时
- **错误恢复**：单个请求失败不影响其他功能（如无法获取流量信息，仍返回代理配置）
- **CORS支持**：响应头包含跨域访问配置
- **请求追踪**：为每个请求生成唯一ID和日志，便于调试和监控

## 业务逻辑

### 协议支持

#### Shadowsocks (SS)
- 格式：`ss://[加密:密码@服务器:端口]#服务器标识符`
- 解析后配置包括：
  - 加密方式
  - 密码
  - 服务器地址和端口
  - UDP支持
  - 证书验证跳过

#### VMess
- 格式：`vmess://[Base64编码的JSON配置]`
- 解析后配置包括：
  - 服务器(add)和端口(port)
  - UUID(id) 和 Alter ID(aid)
  - 传输层(net) 和 TLS配置
  - 允许不安全连接

### 流量管理

- **过期时间计算**：基于账户的月度重置日期
- **流量统计**：
  - 上传流量（通常为0）
  - 下载流量（已使用）
  - 总流量限制（月度配额）
  - 过期时间戳（秒级精度）

### 节点分类策略

- **完整列表**：所有可用的代理节点
- **快速测试列表**：排除高倍率节点（如25倍流量减速节点）
- **负载均衡列表**：优先选择美国、s1、s2、s3等高速节点，排除倍率节点

### 日志记录

每个请求都会生成包括以下信息的完整日志：

```
[requestId] ========== REQUEST START ==========
[requestId] Timestamp: ISO 8601 时间
[requestId] Parameters: 请求参数
[requestId] User-Agent: 用户代理
[requestId] IP: 客户端IP地址
[requestId] Parallel requests completed in Xms
[requestId] Proxy configs parsed in Xms (SS: X, VMess: Y)
[requestId] Clash config generated in Xms (Total proxies: Z)
[requestId] ========== REQUEST END ==========
[requestId] Total time: Xms
```

## 环境配置

### 项目结构

```
vercel/
├── package.json          # 项目配置和依赖
├── vercel.json           # Vercel路由配置
└── api/
    └── index.js          # 主处理函数
```

### Vercel配置说明

- **rewrites**：将 `/justmysocks` 路径重写到 `/api/index.js` 函数
- 依赖：无外部依赖（使用Node.js原生API）

## 响应示例

### 成功响应（YAML文件）

```yaml
# 文件名：ClashConfig-2024-01-22-15-30-45.yaml
proxies:
  - name: "美国1"
    type: ss
    server: c6s1.justmysocks.net
    port: 443
    cipher: aes-256-gcm
    password: your-password
    udp: true
    skip-cert-verify: true

  - name: "日本"
    type: vmess
    server: c6s4.justmysocks.net
    port: 443
    uuid: your-uuid
    alterId: 0
    cipher: chacha20-poly1305
    udp: true
    tls: true
    skip-cert-verify: true
    allowInsecure: true

proxy-groups:
  - name: "🌍 快速测试"
    type: url-test
    proxies:
      - 美国1
      - 日本
```

### 流量信息头

```
Subscription-Userinfo: upload=0; download=5368709120; total=10737418240; expire=1708003200
```

## 错误处理

| 状态码 | 错误类型 | 描述 |
|--------|--------|------|
| 400 | Missing Parameters | 缺少必需的 `service` 或 `id` 参数 |
| 404 | Not Found | 请求路径不是 `/api/justmysocks` |
| 502 | Upstream Error | 无法从JustMySocks获取代理配置 |
| 500 | Server Error | Base64解码失败或其他服务器错误 |

## 性能特性

- **并行处理**：利用Promise.all同时处理三个网络请求
- **流式响应**：直接返回生成的YAML内容，无需中间缓存
- **时间戳记录**：精确记录各阶段处理时间，便于性能分析

## 三个版本的对比

| 特性 | Vercel | ESA | Workers |
|------|--------|-----|---------|
| 部署平台 | Vercel | 阿里云ESA | Cloudflare |
| 全球覆盖 | ✓ | ✓ | ✓✓✓（最优） |
| 函数编写 | Node.js | Fetch API | Fetch API |
| 响应对象 | res.status/json | Response | Response |
| 日志记录 | 平台日志 | 平台日志 | Dashboard + Logpush |
| CDN集成 | ✓ | ✓ | ✓✓（内置） |
| DDoS防护 | ✗ | ✗ | ✓✓✓（内置） |
| 性能 | 中等 | 中等 | 最优 |
| 成本 | 按调用数 | 按调用数 | 按调用数 |