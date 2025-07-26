# Cloudflare Worker - JustMySocks 配置生成器

本项目为Cloudflare Worker，自动处理JustMySocks订阅请求，解析代理信息，获取流量信息，并生成可直接下载的Clash配置文件。

## 功能特性

- 解析指定格式的URL请求，提取参数
- 获取并解析SS/vmess代理信息，自动映射为中文节点名
- 获取流量使用信息，并在响应头返回
- 自动生成Clash配置文件，支持一键下载
- 支持分组、负载均衡、快速测试等策略组自动填充
- 全部响应均支持CORS

## 使用方法

直接访问如下格式的URL：

```
https://your-worker-domain.workers.dev/justmysocks?service=服务编号&id=用户ID&useDomain=true
```

无需额外参数，访问即自动下载Clash配置文件。

### URL参数说明
| 参数      | 类型   | 必需 | 说明           |
|-----------|--------|------|----------------|
| service   | string | ✅   | 服务编号       |
| id        | string | ✅   | 用户ID         |
| useDomain | bool   | ❌   | 是否使用域名   |
| track     | string | ❌   | 跟踪标识       |

---

## 代理配置数据结构（示例，已脱敏）

```json
{
  "type": "ss",
  "name": "美国1",
  "config": {
    "cipher": "加密方式",
    "password": "***",
    "server": "***",
    "port": 12345,
    "udp": true,
    "skipCertVerify": true
  }
}

{
  "type": "vmess",
  "name": "美国0.1倍流量",
  "config": {
    "ps": "美国0.1倍流量",
    "port": "12345",
    "id": "***",
    "aid": 0,
    "udp": false,
    "type": "none",
    "tls": false,
    "skipCertVerify": true,
    "alterId": 0,
    "allowInsecure": true
  }
}
```

- `name`：自动映射为中文节点名（如“美国1”、“日本”等）
- `udp`：vmess类型根据net字段自动判断，tcp为false，其它为true
- 其余敏感信息已脱敏

---

## Clash配置文件说明

- 访问Worker即自动下载生成的Clash配置文件（YAML格式）
- 节点名称均为中文友好名
- 支持分组、负载均衡、快速测试等策略组
- 主要占位符：
  - `{ProxyList}`：所有节点配置
  - `{ProxiesNames}`：所有节点名称
  - `{FastestProxiesNames}`：快速测试组节点名（排除“25倍”）
  - `{BalanceProxiesNames}`：负载均衡组节点名（包含“美国”且不含“倍”）

---

## 流量信息

Worker会自动从官方接口获取流量信息，并在响应头返回：

```
Subscription-Userinfo: upload=0; download=xxxx; total=yyyy; expire=zzzz
```
- `upload`：上传流量（字节，固定为0）
- `download`：已用流量（字节）
- `total`：总流量（字节）
- `expire`：下次流量重置时间（Unix时间戳）

---

## 典型流程
1. 访问Worker URL，自动获取并解析代理信息
2. 自动获取流量信息
3. 自动生成Clash配置文件并下载
4. 配置文件内容已脱敏，节点名为中文

---

## 注意事项
- 所有敏感信息（如密码、服务器地址、UUID等）均不会在README或示例中展示
- Worker返回的配置文件内容为真实数据，使用时请妥善保管
- 如需自定义映射或分组逻辑，可修改worker.js中的相关映射表和分组规则 