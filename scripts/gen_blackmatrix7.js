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
        let resolved = false;

        const req = protocol.request(url, {
            method: 'GET',
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Node.js)'
            }
        }, (res) => {
            resolved = true;
            // 状态码 200-399 都认为是成功
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });

        req.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                console.error(`    └─ URL check error: ${err.message}`);
                resolve(false);
            }
        });

        req.on('timeout', () => {
            if (!resolved) {
                resolved = true;
                req.destroy();
                resolve(false);
            }
        });

        req.end();
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
                console.log(`  ├─ ✅ Available`);
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
            if (proxy === '{ProxiesNames}')
                temp.proxies.push(`{ProxiesNames}`);
            else
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
        let content = fs.readFileSync(clashConfigPath, 'utf8');

        // 定义需要替换的块：[开始标签, 结束标签, 替换内容]
        const blocks = [
            ['#自动生成代理BEGIN', '#自动生成代理END', temp.proxies.join('\n')],
            ['#自动生成规则BEGIN', '#自动生成规则END', temp.ruleProviders.join('\n')],
            ['#自动生成分流规则BEGIN', '#自动生成分流规则END', temp.flowRules.join('\n')]
        ];

        // 从后往前替换（避免前面替换影响后面的索引）
        for (let i = blocks.length - 1; i >= 0; i--) {
            const [beginTag, endTag, replacement] = blocks[i];
            
            // 找到标签位置
            const beginIdx = content.indexOf(beginTag);
            const endIdx = content.indexOf(endTag);

            if (beginIdx === -1 || endIdx === -1) {
                throw new Error(`Missing markers: ${beginTag} or ${endTag}`);
            }

            // 标签后的换行和标签前的换行
            const contentStart = content.indexOf('\n', beginIdx) + 1;
            const contentEnd = content.lastIndexOf('\n', endIdx);

            // 替换内容块（保留标签和前后空行）
            content = content.substring(0, contentStart) + replacement + content.substring(contentEnd);
        }

        fs.writeFileSync(clashConfigPath, content);
        console.log(`✅ Clash config updated: ${clashConfigPath}`);
    } catch (error) {
        console.error(`❌ Error updating Clash config: ${error.message}`);
        process.exit(1);
    }

    console.log(`\n✨ Done! Generated files in: ${target_dir}`);
}

/**
 * 清理多余文件
 */
async function cleanup() {
    const toRemove = ['node_modules', 'bodejs'];

    console.log('\n🧹 Cleaning up unnecessary files...');
    for (const item of toRemove) {
        if (fs.existsSync(item)) {
            try {
                fs.rmSync(item, { recursive: true, force: true });
                console.log(`  ✅ Removed: ${item}`);
            } catch (error) {
                console.error(`  ❌ Error removing ${item}: ${error.message}`);
            }
        }
    }
}

main()
    .then(() => cleanup())
    .catch(error => {
        console.error(`❌ Fatal error: ${error.message}`);
        process.exit(1);
    });
