import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from scripts import update_rules as rules


class RuleBackupTests(unittest.TestCase):
    def test_every_provider_uses_a_valid_repository_backup(self):
        rules.audit_provider_backups()

    def test_classical_sources_merge_in_order_and_deduplicate(self):
        contents = {
            "first": b"# comment\nDOMAIN,a.example\nDOMAIN,b.example\n",
            "second": b"DOMAIN,b.example\nDOMAIN,c.example\n",
        }
        with patch.object(rules, "download", side_effect=contents.__getitem__):
            result = rules.build_classical(["first", "second"])
        self.assertEqual(yaml.safe_load(result)["payload"], [
            "DOMAIN,a.example", "DOMAIN,b.example", "DOMAIN,c.example",
        ])

    def test_failed_update_keeps_valid_backup(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(rules, "ROOT", Path(folder)):
            backup = Path(folder) / "rules" / "gen_blackmatrix7" / "Test.yaml"
            backup.parent.mkdir(parents=True)
            backup.write_text("payload:\n  - DOMAIN,old.example\n", encoding="utf-8")
            warnings = []
            rules.mirror(backup, lambda: (_ for _ in ()).throw(OSError("gone")),
                         lambda data: rules.validate_yaml(data, "classical"), False, warnings)
            self.assertIn("old.example", backup.read_text(encoding="utf-8"))
            self.assertEqual(len(warnings), 1)
            backup.unlink()
            with self.assertRaisesRegex(RuntimeError, "No valid backup"):
                rules.mirror(backup, lambda: (_ for _ in ()).throw(OSError("gone")),
                             lambda data: rules.validate_yaml(data, "classical"), False, [])

    def test_generated_blocks_keep_custom_rules_and_references(self):
        with tempfile.TemporaryDirectory() as folder:
            template = Path(folder) / "ClashConfigTemp.yaml"
            template.write_text((rules.ROOT / "ClashConfigTemp.yaml").read_text(encoding="utf-8"), encoding="utf-8")
            with patch.object(rules, "TEMPLATE", template):
                rules.regenerate_template([{
                    "name": "Example", "urls": ["unused"], "default_proxy": "DIRECT",
                }], "")
            text = template.read_text(encoding="utf-8")
            self.assertIn("RULE-SET,CustomProxy,默认节点", text)
            self.assertIn("RULE-SET,Example,Example", text)
            self.assertIn("https://raw.githubusercontent.com/ningjx/Clash-Rules/master/rules/gen_blackmatrix7/Example.yaml", text)
            self.assertNotIn("RULE-SET,YouTube,YouTube", text)


if __name__ == "__main__":
    unittest.main()
