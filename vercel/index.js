// pages/api/justmysocks.js
import { Buffer } from 'buffer';

export default async function handler(req, res) {
  try {
    // 检查请求方法
    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
      });
    }

    const { service, id, useDomain: useDomainValue, track } = req.query;

    // 检查必需参数
    if (!service || !id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: service and id',
      });
    }

    // 解析useDomain参数
    const useDomain = !(useDomainValue === 'false' || useDomainValue === '0');

    // 构建参数对象
    const params = {
      service: service,
      id: id,
      useDomain: useDomain,
      track: track || null,
    };

    console.log('Received request with parameters:', params);

    // 获取流量信息
    const bwUrl = `https://justmysocks3.net/members/getbwcounter.php?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`;
    let bwInfo = null;
    let subscriptionUserinfo = '';

    try {
      const bwResp = await fetch(bwUrl);
      if (bwResp.ok) {
        bwInfo = await bwResp.json();

        // 计算过期时间（基于bw_reset_day_of_month）
        const now = new Date();
        let expireDate = new Date(now.getFullYear(), now.getMonth(), bwInfo.bw_reset_day_of_month, 7, 0, 0);

        // 如果当前日期已经过了重置日，则设置为下个月的重置日
        if (now.getDate() > bwInfo.bw_reset_day_of_month) {
          expireDate = new Date(now.getFullYear(), now.getMonth() + 1, bwInfo.bw_reset_day_of_month, 7, 0, 0);
        }

        // 转换为时间戳（秒）
        const expireTimestamp = Math.floor(expireDate.getTime() / 1000);

        // 1024进制转1000进制（乘以1.073741824）
        const bw_counter_b_1000 = Math.round(bwInfo.bw_counter_b * 1.073741824);
        const monthly_bw_limit_b_1000 = Math.round(bwInfo.monthly_bw_limit_b * 1.073741824);

        // 构建Subscription-Userinfo字符串
        subscriptionUserinfo = `upload=0; download=${bw_counter_b_1000}; total=${monthly_bw_limit_b_1000}; expire=${expireTimestamp}`;
      }
    } catch (e) {
      console.error('获取流量信息失败:', e);
    }

    // 拼接目标URL
    const baseUrl = 'https://jmssub.net/members/getsub.php';
    const usedomains = useDomain ? 1 : 0;
    const queryUrl = `${baseUrl}?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}&usedomains=${encodeURIComponent(usedomains)}`;

    // 请求目标URL
    const upstreamResp = await fetch(queryUrl);
    if (!upstreamResp.ok) {
      return res.status(502).json({
        success: false,
        error: 'Upstream fetch failed',
        status: upstreamResp.status,
      });
    }

    // 获取base64文本
    const base64Text = await upstreamResp.text();

    // base64解码
    let decodedText = '';
    try {
      // 在Node.js环境中使用Buffer进行base64解码
      decodedText = Buffer.from(base64Text.replace(/\s/g, ''), 'base64').toString('utf-8');
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Base64 decode failed',
        message: e.message,
      });
    }

    // 解析代理配置
    const lines = decodedText.split('\n').filter(line => line.trim());
    const proxyConfigs = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('ss://')) {
        // 解析ss://配置
        try {
          const ssMatch = trimmedLine.match(/^ss:\/\/([^#]+)#(.+)$/);
          if (ssMatch) {
            // 在Node.js环境中使用Buffer进行base64解码
            const ssPart = Buffer.from(ssMatch[1], 'base64').toString('utf-8');
            
            // 解析ss://格式: cipher:password@server:port
            const ssInfoMatch = ssPart.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);
            if (ssInfoMatch) {
              const [, cipher, password, server, port] = ssInfoMatch;
              // 提取服务器标识符（如c6s4）
              const serverId = server.split('.')[0];
              proxyConfigs.push({
                type: 'ss',
                name: serverId,
                config: {
                  cipher: cipher,
                  password: password,
                  server: server,
                  port: parseInt(port),
                  udp: true,
                  skipCertVerify: true,
                },
              });
            }
          }
        } catch (e) {
          console.error('SS解析错误:', e);
        }
      } else if (trimmedLine.startsWith('vmess://')) {
        // 解析vmess://配置
        try {
          const vmessMatch = trimmedLine.match(/^vmess:\/\/(.+)$/);
          if (vmessMatch) {
            // 在Node.js环境中使用Buffer进行base64解码
            const vmessJson = Buffer.from(vmessMatch[1], 'base64').toString('utf-8');
            const vmessConfig = JSON.parse(vmessJson);

            proxyConfigs.push({
              type: 'vmess',
              name: vmessConfig.ps ? vmessConfig.ps.split('@')[1].split('.')[0] : vmessConfig.add.split('.')[0],
              config: {
                ...vmessConfig,
                skipCertVerify: true,
                udp: vmessConfig.net ? (vmessConfig.net !== 'tcp') : false,
                alterId: vmessConfig.aid || 0,
                allowInsecure: true,
              },
            });
          }
        } catch (e) {
          console.error('VMess解析错误:', e);
        }
      }
    }

    // 返回解析后的配置
    const responseData = {
      success: true,
      message: '代理配置解析成功',
      originalText: decodedText,
      proxyConfigs: proxyConfigs,
      timestamp: new Date().toISOString(),
    };

    // 获取Clash模板并生成配置
    try {
      const templateUrl = 'https://raw.githubusercontent.com/ningjx/Clash-Rules/master/ClashConfigTemp.yaml';
      const templateResp = await fetch(templateUrl);

      if (templateResp.ok) {
        let template = await templateResp.text();

        // 生成代理列表
        let proxyList = '';
        const proxyNames = [];

        // 代理名称映射
        const proxyNameMapping = {
          'c6s1': '美国1',
          'c6s2': '美国2',
          'c6s3': '美国3',
          'c6s4': '日本',
          'c6s5': '荷兰',
          'c6s801': '美国0.1倍流量',
        };

        for (const proxyConfig of proxyConfigs) {
          if (!proxyConfig || !proxyConfig.config) continue;

          const proxy = proxyConfig.config;
          if (proxy.server === "0.0.0.0") continue;

          // 直接修改proxyConfig.name为映射后的中文名
          if (proxyNameMapping[proxyConfig.name]) {
            proxyConfig.name = proxyNameMapping[proxyConfig.name];
          }

          // 生成YAML格式的代理配置
          proxyList += '  - ';
          proxyList += `name: "${proxyConfig.name}"\n`;
          proxyList += `    type: ${proxyConfig.type === 'ss' ? 'ss' : 'vmess'}\n`;

          if (proxyConfig.type === 'ss') {
            proxyList += `    server: ${proxy.server}\n`;
            proxyList += `    port: ${proxy.port}\n`;
            proxyList += `    cipher: ${proxy.cipher}\n`;
            proxyList += `    password: ${proxy.password}\n`;
            proxyList += `    udp: ${proxy.udp}\n`;
            proxyList += `    skip-cert-verify: ${proxy.skipCertVerify}\n`;
          } else if (proxyConfig.type === 'vmess') {
            proxyList += `    server: ${proxy.add}\n`;
            proxyList += `    port: ${proxy.port}\n`;
            proxyList += `    uuid: ${proxy.id}\n`;
            proxyList += `    alterId: ${proxy.alterId}\n`;
            proxyList += `    cipher: chacha20-poly1305\n`;
            proxyList += `    udp: ${proxy.udp}\n`;
            proxyList += `    tls: ${proxy.tls === 'none' ? false : true}\n`;
            proxyList += `    skip-cert-verify: ${proxy.skipCertVerify}\n`;
            proxyList += `    allowInsecure: true\n`;
          }
          proxyList += '\n';

          proxyNames.push(proxyConfig.name);
        }

        // 生成代理名称列表
        let proxyNameStr = '';
        for (let i = 0; i < proxyNames.length; i++) {
          const name = proxyNames[i];
          proxyNameStr += `      - ${name}`;
          if (i < proxyNames.length - 1) {
            proxyNameStr += '\n';
          }
        }

        // 生成快速测试代理名称列表（排除25倍流量节点）
        let testFastNames = '';
        for (let i = 0; i < proxyNames.length; i++) {
          const name = proxyNames[i];
          if (!name.includes('25倍')) {
            testFastNames += `      - ${name}`;
            if (i < proxyNames.length - 1) {
              testFastNames += '\n';
            }
          }
        }

        // 生成负载均衡代理名称列表（选择包含美国、s1、s2、s3的节点，排除倍率节点）
        let balanceNames = '';
        const blanProxyNames = proxyNames.filter(name =>
          (name.includes('美国') || name.includes('s1') || name.includes('s2') || name.includes('s3')) && !name.includes('倍')
        );

        for (let i = 0; i < blanProxyNames.length; i++) {
          const name = blanProxyNames[i];
          balanceNames += `      - ${name}`;
          if (i < proxyNames.length - 1) {
            balanceNames += '\n';
          }
        }

        // 替换模板中的占位符
        template = template.replaceAll('{ProxyList}', proxyList);
        template = template.replaceAll('{ProxiesNames}', proxyNameStr);
        template = template.replaceAll('{FastestProxiesNames}', testFastNames);
        template = template.replaceAll('{BalanceProxiesNames}', balanceNames);

        // 添加生成的Clash配置到响应数据
        responseData.clashConfig = template;
      }
    } catch (e) {
      console.error('获取Clash模板失败:', e);
    }

    // 构建响应头
    const responseHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 如果有流量信息，添加到响应头
    if (subscriptionUserinfo) {
      responseHeaders['Subscription-Userinfo'] = subscriptionUserinfo;
    }

    // 始终将生成的Clash配置作为文件下载返回
    if (responseData.clashConfig) {
      // 动态生成文件名
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const fileName = `ClashConfig-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.yaml`;
      
      res.setHeader('Content-Type', 'application/x-yaml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (subscriptionUserinfo) {
        res.setHeader('Subscription-Userinfo', subscriptionUserinfo);
      }
      
      return res.status(200).send(responseData.clashConfig);
    }

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error processing request:', error);

    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message,
    });
  }
}

// 添加配置以处理OPTIONS请求
export const config = {
  api: {
    bodyParser: false,
  },
};



