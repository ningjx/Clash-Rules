#!/usr/bin/env python3
"""Mirror referenced rule sets and regenerate the three marked template sections."""

from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
RULES_DIR = ROOT / "rules"
TEMPLATE = ROOT / "ClashConfigTemp.yaml"
BM_CONFIG = ROOT / "configs/config_blackmatrix7.yml"
SOURCES_CONFIG = ROOT / "configs/rule_sources.yml"
RAW_SELF = "https://raw.githubusercontent.com/ningjx/Clash-Rules/master"
RAW_LOYAL = "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release"
RAW_META = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta"
MRS_MAGIC = b"\x28\xb5\x2f\xfd"  # MRS files currently use a zstd frame.
MAX_BYTES = 16 * 1024 * 1024
CLASSICAL_TYPES = {
    "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-WILDCARD", "DOMAIN-REGEX",
    "IP-CIDR", "IP-CIDR6", "IP-ASN", "GEOIP", "PROCESS-NAME", "PROCESS-PATH",
}


class IndentedDumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


def read_config(path: Path) -> dict:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Invalid config: {path}")
    return value


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Clash-Rules-rule-backup/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise ValueError(f"HTTP {response.status}")
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError("rule file exceeds 16 MiB")
                return data
        except (OSError, urllib.error.HTTPError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def validate_yaml(data: bytes, behavior: str) -> list[str]:
    value = yaml.safe_load(data.decode("utf-8-sig"))
    if not isinstance(value, dict) or not isinstance(value.get("payload"), list):
        raise ValueError("rule file has no YAML payload")
    rules = value["payload"]
    if not rules or any(not isinstance(rule, str) or not rule.strip() for rule in rules):
        raise ValueError("rule file has an empty or invalid payload")
    if behavior == "ipcidr" and any("/" not in rule for rule in rules):
        raise ValueError("IP rule file contains a non-CIDR entry")
    if behavior == "classical" and any(rule.split(",", 1)[0] not in CLASSICAL_TYPES or "," not in rule for rule in rules):
        raise ValueError("classical rule file contains an unknown rule type")
    return rules


def validate_mrs(data: bytes) -> None:
    if len(data) < 32 or not data.startswith(MRS_MAGIC):
        raise ValueError("rule file is not an MRS zstd frame")


def mirror(path: Path, source, validator, offline: bool, warnings: list[str]) -> None:
    if offline:
        validator(path.read_bytes())
        return
    try:
        data = source()
        validator(data)
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        if not path.is_file():
            raise RuntimeError(f"No valid backup for {path.relative_to(ROOT)}: {exc}") from exc
        try:
            validator(path.read_bytes())
        except (OSError, UnicodeError, ValueError, yaml.YAMLError) as bad_backup:
            raise RuntimeError(f"Invalid backup for {path.relative_to(ROOT)}: {bad_backup}") from bad_backup
        warnings.append(f"{path.relative_to(ROOT)}: upstream unavailable ({exc}); kept existing backup")
        return
    if not path.is_file() or path.read_bytes() != data:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"Updated {path.relative_to(ROOT)}")


def build_classical(urls: list[str]) -> bytes:
    rules: list[str] = []
    seen: set[str] = set()
    for url in urls:
        for line in download(url).decode("utf-8-sig").splitlines():
            rule = line.strip()
            if not rule or rule.startswith("#"):
                continue
            if "," not in rule or rule.split(",", 1)[0] not in CLASSICAL_TYPES or "\x00" in rule:
                raise ValueError(f"Invalid classical rule in {url}: {rule[:80]}")
            if rule not in seen:
                rules.append(rule)
                seen.add(rule)
    if not rules:
        raise ValueError("empty classical rule set")
    return yaml.dump({"payload": rules}, Dumper=IndentedDumper,
                     allow_unicode=True, sort_keys=False, width=1000).encode("utf-8")


def replace_block(text: str, begin: str, end: str, lines: list[str]) -> str:
    pattern = re.compile(rf"(?<={re.escape(begin)}\n).*?(?=\n{re.escape(end)})", re.DOTALL)
    replaced, count = pattern.subn(lambda _: "\n".join(lines), text)
    if count != 1:
        raise ValueError(f"Expected one template block: {begin} / {end}")
    return replaced


def local_url(mirror_site: str, relative_path: str) -> str:
    raw = f"{RAW_SELF}/{relative_path}"
    return f"{mirror_site.rstrip('/')}/{raw}" if mirror_site else raw


def regenerate_template(rules: list[dict], mirror_site: str) -> None:
    text = TEMPLATE.read_text(encoding="utf-8")
    groups: list[str] = []
    providers: list[str] = []
    routes: list[str] = []
    for rule in rules:
        name = rule["name"]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", name):
            raise ValueError(f"Unsafe rule name: {name}")
        choices = ["默认节点", "最快节点", "{ProxiesNames}", "DIRECT"]
        preferred = rule.get("default_proxy")
        if preferred:
            if preferred in choices:
                choices.remove(preferred)
            choices.insert(0, preferred)
        groups += [f"  - name: {name}", "    type: select", "    proxies:"]
        groups += ["{ProxiesNames}" if choice == "{ProxiesNames}" else f"      - {choice}" for choice in choices]
        providers += [
            f"  {name}:", "    type: http", "    behavior: classical",
            f"    url: {local_url(mirror_site, f'rules/gen_blackmatrix7/{name}.yaml')}",
            f'    path: "./rule_provider/{name}.yaml"', "    interval: 86400",
        ]
        routes.append(f"  - RULE-SET,{name},{name}")
    for begin, end, lines in (
        ("#自动生成代理BEGIN", "#自动生成代理END", groups),
        ("#自动生成规则BEGIN", "#自动生成规则END", providers),
        ("#自动生成分流规则BEGIN", "#自动生成分流规则END", routes),
    ):
        text = replace_block(text, begin, end, lines)
    # Placeholders become temporary YAML values solely for structural validation.
    check = re.sub(r"^\{ProxyList\}$", "", text, flags=re.MULTILINE)
    check = re.sub(r"^\{(?:ProxiesNames|BalanceProxiesNames)\}$", "      - __test_proxy__", check, flags=re.MULTILINE)
    parsed = yaml.safe_load(check)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("rule-providers"), dict):
        raise ValueError("Generated template is not a valid Mihomo configuration")
    defined = set(parsed["rule-providers"])
    referenced = {line.split(",")[1] for line in parsed["rules"] if line.startswith("RULE-SET,")}
    if missing := referenced - defined:
        raise ValueError(f"Undefined rule providers: {sorted(missing)}")
    if TEMPLATE.read_text(encoding="utf-8") != text:
        TEMPLATE.write_text(text, encoding="utf-8", newline="\n")
        print("Updated ClashConfigTemp.yaml")


def audit_provider_backups() -> None:
    text = TEMPLATE.read_text(encoding="utf-8")
    text = re.sub(r"^\{ProxyList\}$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\{(?:ProxiesNames|BalanceProxiesNames)\}$", "      - __test_proxy__", text, flags=re.MULTILINE)
    providers = yaml.safe_load(text)["rule-providers"]
    for name, provider in providers.items():
        url = provider["url"]
        match = re.search(r"https://raw\.githubusercontent\.com/ningjx/Clash-Rules/(?:refs/heads/)?master/([^\s]+)", url)
        if not match:
            raise ValueError(f"{name} still references an external rule repository: {url}")
        relative = Path(urllib.parse.unquote(match.group(1)))
        if ".." in relative.parts or relative.is_absolute():
            raise ValueError(f"Unsafe backup path for {name}: {relative}")
        backup = ROOT / relative
        if not backup.is_file():
            raise ValueError(f"Missing backup for {name}: {relative}")
        data = backup.read_bytes()
        if provider.get("format") == "mrs":
            validate_mrs(data)
        else:
            validate_yaml(data, provider["behavior"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="validate backups and regenerate template without downloading")
    args = parser.parse_args()
    bm = read_config(BM_CONFIG)
    sources = read_config(SOURCES_CONFIG)
    warnings: list[str] = []
    bm_rules = bm["rules"]
    for rule in bm_rules:
        name = rule["name"]
        path = RULES_DIR / "gen_blackmatrix7" / f"{name}.yaml"
        mirror(path, lambda rule=rule: build_classical(rule["urls"]),
               lambda data: validate_yaml(data, "classical"), args.offline, warnings)
    for behavior, names in sources["loyalsoldier"].items():
        for name in names:
            path = RULES_DIR / "gen_loyalsoldier" / f"{name}.txt"
            mirror(path, lambda name=name: download(f"{RAW_LOYAL}/{name}.txt"),
                   lambda data, behavior=behavior: validate_yaml(data, behavior), args.offline, warnings)
    for name, upstream_path in sources["metacubex"].items():
        path = RULES_DIR / "gen_metacubex" / upstream_path
        mirror(path, lambda upstream_path=upstream_path: download(f"{RAW_META}/{upstream_path}"),
               validate_mrs, args.offline, warnings)
    regenerate_template(bm_rules, bm.get("mirror_site", ""))
    audit_provider_backups()
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    print(f"Rule backup complete: {len(warnings)} upstream failure(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
