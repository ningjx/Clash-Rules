#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const yaml = require('js-yaml');

/**
 * 读取 YAML 配置文件
 */
function readConfig(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    return yaml.load(fileContents);
  } catch (e) {
    console.error(`Error reading config file: ${e}`);
    process.exit(1);
  }
}

/**
 * 下载文件内容
 */
function downloadFileContent(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    let data = '';
    
    protocol.get(url, response => {
      response.on('data', chunk => {
        data += chunk;
      });
      response.on('end', () => {
        resolve(data);
      });
    }).on('error', err => {
      reject(err);
    });
  });
}

/**
 * 检查 URL 是否可用
 */
function checkUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 处理规则：去除注释、IP-ASN 和空行，生成 YAML 格式
 */
function processRuleContent(content) {
  const lines = content
    .split('\n')
    .filter(line => {
      // 过滤掉注释、IP-ASN 类型和空行
      return line && !line.startsWith('#');// && !line.includes('IP-ASN');
    })
    .map(line => `  - ${line.trim()}`)
    .join('\n');
  
  return lines;
}

/**
 * 主函数
 */
async function main() {
  const configPath = process.argv[2] || './configs/config_blackmatrix7.yml';
  const clashConfigPath = process.argv[3] || './ClashConfigTemp.yaml';

  console.log(`📖 Reading config from: ${configPath}`);
  const config = readConfig(configPath);

  const { mirror_site, target_dir, rules } = config;
  
  // 确保目录存在
  if (!fs.existsSync(target_dir)) {
    fs.mkdirSync(target_dir, { recursive: true });
  }

  console.log(`🎯 Target directory: ${target_dir}`);
  console.log(`🌐 Mirror site: ${mirror_site}`);
  console.log(`📋 Rules to process: ${rules.length}\n`);

  // 默认代理节点列表（默认顺序）
  const defaultProxies = ['默认节点', '最快节点', '{ProxiesNames}', 'DIRECT'];

  // 临时文件收集器
  const temp = {
    proxies: [],      // temp2.txt - 代理配置
    ruleProviders: [], // temp4.txt - 规则提供者
    flowRules: []      // temp6.txt - 分流规则
  };

  // 处理每个规则
  for (const rule of rules) {
    const { name, urls, default_proxy } = rule;
    console.log(`\n🔄 Processing rule: ${name}`);

    let isFirst = true;
    let ruleContent = '';

    // 处理该规则的所有 URL
    for (const url of urls) {
      const filename = path.basename(url);
      const purename = path.parse(filename).name;

      console.log(`  ├─ Checking URL: ${url}`);
      const isAvailable = await checkUrl(url);

      if (isAvailable) {
        console.log(`  ├─ ✅ Downloading...`);
        try {
          const content = await downloadFileContent(url);
          const processedContent = processRuleContent(content);
          
          if (isFirst) {
            ruleContent = 'payload:\n' + processedContent;
            isFirst = false;
          } else {
            ruleContent += '\n' + processedContent;
          }
        } catch (error) {
          console.error(`  ├─ ❌ Error downloading: ${error.message}`);
        }
      } else {
        console.log(`  ├─ ❌ URL unavailable (keeping existing file)`);
      }
    }

    // 写入规则文件
    if (ruleContent) {
      fs.writeFileSync(path.join(target_dir, `${name}.yaml`), ruleContent);
      console.log(`  └─ ✅ Saved: ${path.join(target_dir, `${name}.yaml`)}`);
    }

    // 生成代理配置
    temp.proxies.push(`  - name: ${name}`);
    temp.proxies.push(`    type: select`);
    temp.proxies.push(`    proxies:`);
    
    // 创建代理列表副本
    let proxiesList = [...defaultProxies];
    
    // 如果配置了 default_proxy，将其调整到最前面
    if (rule.default_proxy) {
      const index = proxiesList.indexOf(rule.default_proxy);
      if (index > -1) {
        // 在默认列表中，移除后添加到最前面
        proxiesList.splice(index, 1);
        proxiesList.unshift(rule.default_proxy);
      } else {
        // 不在默认列表中，直接添加到最前面
        proxiesList.unshift(rule.default_proxy);
      }
    }
    
    // 将所有代理添加到配置中
    for (const proxy of proxiesList) {
      temp.proxies.push(`      - ${proxy}`);
    }

    // 生成规则提供者配置
    temp.ruleProviders.push(`  ${name}:`);
    temp.ruleProviders.push(`    type: http`);
    temp.ruleProviders.push(`    behavior: classical`);
    temp.ruleProviders.push(`    url: ${mirror_site}/https://raw.githubusercontent.com/ningjx/Clash-Rules/master/${target_dir}/${name}.yaml`);
    temp.ruleProviders.push(`    path: "./rule_provider/${name}.yaml"`);
    temp.ruleProviders.push(`    interval: 86400`);

    // 生成分流规则
    temp.flowRules.push(`  - RULE-SET,${name},${name}`);
  }

  // 组合最终的 Clash 配置
  console.log(`\n📝 Regenerating Clash config...`);
  try {
    const originalContent = fs.readFileSync(clashConfigPath, 'utf8');
    
    // 提取标记之间的内容
    const part1 = originalContent.substring(0, originalContent.indexOf('#自动生成代理BEGIN') + '#自动生成代理BEGIN'.length);
    const part3 = originalContent.substring(originalContent.indexOf('#自动生成代理END'), originalContent.indexOf('#自动生成规则BEGIN'));
    const part5 = originalContent.substring(originalContent.indexOf('#自动生成规则END'), originalContent.indexOf('#自动生成分流规则BEGIN'));
    const part7 = originalContent.substring(originalContent.indexOf('#自动生成分流规则END'));

    const newContent = 
      part1 + '\n' +
      temp.proxies.join('\n') + '\n' +
      part3 + '\n' +
      temp.ruleProviders.join('\n') + '\n' +
      part5 + '\n' +
      temp.flowRules.join('\n') + '\n' +
      part7;

    fs.writeFileSync(clashConfigPath, newContent);
    console.log(`✅ Clash config updated: ${clashConfigPath}`);
  } catch (error) {
    console.error(`❌ Error updating Clash config: ${error.message}`);
  }

  console.log(`\n✨ Done! Generated files in: ${target_dir}`);
}

main().catch(error => {
  console.error(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});
