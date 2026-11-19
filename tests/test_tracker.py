import csv
import io
import json
import re
import tempfile
import unittest
from pathlib import Path

from app import create_app

NOV = "start=2026-11-01&end=2026-11-30"
FULL = "start=2026-09-01&end=2026-11-30"


class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name, "test.sqlite3")
        self.app = create_app(self.path)
        self.client = self.app.test_client()

    def add(self, amount="100", **changes):
        data = {
            "kind": "expense",
            "category": "Groceries",
            "day": "2026-11-15",
            "amount": amount,
        }
        return self.client.post("/transactions", json=data | changes)

    def budget(self, amount="1000", **changes):
        data = {"month": "2026-11", "category": "Groceries", "amount": amount}
        return self.client.post("/budgets", json=data | changes)

    def report(self, period=NOV, month="2026-11"):
        result = self.client.get(f"/?{period}&month={month}")
        self.assertEqual(result.status_code, 200)
        html = result.get_data(as_text=True)
        chart = re.search(
            r'<script id="chart-data" type="application/json">(.*?)</script>', html
        )
        return html, json.loads(chart[1])

    def seed(self):
        return self.app.test_cli_runner().invoke(args=["seed-demo"])

    def test_full_classroom_walkthrough(self):
        self.assertEqual(self.seed().exit_code, 0)
        html, data = self.report()
        self.assertIn("₹9,000", html)
        self.assertIn("70% used", html)
        self.assertIn("No budget set", html)
        self.assertEqual(self.add().status_code, 201)
        self.assertIn("Nearing limit", self.report()[0])
        self.assertEqual(self.add("250").status_code, 201)
        self.client = create_app(self.path).test_client()
        html, data = self.report()
        for text in ("₹8,650", "₹1,350", "105% used", "₹50 over budget", "Over budget"):
            self.assertIn(text, html)
        html, data = self.report("start=2026-11-15&end=2026-11-15")
        self.assertEqual(
            data["expenses"], [{"category": "Groceries", "count": 2, "paise": 35000}]
        )
        self.assertIn("₹1,050", html)
        html, data = self.report(FULL)
        self.assertEqual([row["paise"] for row in data["trend"]], [60000, 0, 135000])
        total = sum(row["paise"] for row in data["expenses"])
        self.assertEqual(total, sum(row["paise"] for row in data["trend"]))
        self.assertEqual(total, 195000)
        expected = [
            {"category": "Groceries", "transaction_count": 4, "total_inr": "1650.00"},
            {"category": "Transport", "transaction_count": 1, "total_inr": "300.00"},
        ]
        result = self.client.get("/exports/json?" + FULL)
        self.assertEqual(result.json, expected)
        self.assertIn("attachment;", result.headers["Content-Disposition"])
        download = self.client.get("/exports/csv?" + FULL)
        rows = list(csv.DictReader(io.StringIO(download.get_data(as_text=True))))
        self.assertEqual(
            rows,
            [
                row | {"transaction_count": str(row["transaction_count"])}
                for row in expected
            ],
        )
        self.assertNotEqual(self.seed().exit_code, 0)
        self.assertEqual(self.client.get("/exports/json?" + FULL).json, expected)

    def test_amount_boundaries_and_zero_spend_budget(self):
        self.assertEqual(self.budget().status_code, 200)
        self.assertIn("0% used", self.report()[0])
        for amount, status, detail in [
            ("799.99", "On track", "79.99% used"),
            ("0.01", "Nearing limit", "80% used"),
            ("200", "At limit", "100% used"),
            ("0.01", "Over budget", "₹0.01 over budget"),
        ]:
            with self.subTest(amount=amount, status=status):
                self.assertEqual(self.add(amount).status_code, 201)
                html, _ = self.report()
                self.assertIn(status, html)
                self.assertIn(detail, html)

    def test_month_boundary_replacement_cap_and_inclusive_filter(self):
        self.budget("20", month="2026-10")
        self.budget("50")
        self.add("10", day="2026-10-31")
        self.add("20", day="2026-11-01")
        self.budget("10")
        html, data = self.report("start=2026-10-31&end=2026-11-01")
        self.assertIn("200% used", html)
        self.assertEqual(data["expenses"][0]["paise"], 3000)
        self.assertIn("50% used", self.report(month="2026-10")[0])

    def test_validation_does_not_write(self):
        for amount in ("0", "-1", "1.111", "NaN", "1e2", "1234567890123", None, 0.1):
            with self.subTest(amount=amount):
                self.assertEqual(self.add(amount).status_code, 422)
                self.assertIn("amount", self.budget(amount).json["errors"])
        for key, value in [
            ("day", "2026-02-29"),
            ("day", ""),
            ("day", "20261115"),
            ("category", "Salary"),
            ("category", "Missing"),
            ("kind", "other"),
            ("note", "x" * 501),
        ]:
            self.assertIn(key, self.add(**{key: value}).json["errors"])
        self.assertIn("month", self.budget(month="2026-13").json["errors"])
        self.assertIn("category", self.budget(category="Salary").json["errors"])
        self.assertEqual(
            self.client.post("/transactions", json=["invalid"]).status_code, 400
        )
        self.assertEqual(
            self.client.post("/transactions", data={"amount": "5"}).status_code, 415
        )
        self.assertEqual(self.client.get("/exports/json?" + NOV).json, [])
        self.assertNotIn("budget-row", self.report()[0])

    def test_empty_invalid_and_exact_decimal_exports(self):
        self.add("5", kind="income", category="Salary")
        html, data = self.report()
        self.assertIn("No expenses in this period", html)
        self.assertEqual(data["trend"][0]["paise"], 0)
        empty_csv = self.client.get("/exports/csv?" + NOV).get_data(as_text=True)
        self.assertEqual(empty_csv, "category,transaction_count,total_inr\r\n")
        for bad_range in ("start=2026-11-16&end=2026-11-15", "start=2026-02-30"):
            for path in ("/?", "/exports/json?"):
                self.assertEqual(self.client.get(path + bad_range).status_code, 400)
        self.assertEqual(self.client.get("/?month=2026-00").status_code, 400)
        self.add("0.10")
        self.add("0.20")
        self.assertEqual(
            self.client.get("/exports/json?" + NOV).json[0]["total_inr"], "0.30"
        )
        other = self.client.get("/exports/json?start=2026-11-16&end=2026-11-16")
        self.assertEqual(other.json, [])

    def test_required_keys_and_user_input_escaping(self):
        errors = self.client.post("/transactions", json={}).json["errors"]
        self.assertEqual(set(errors), {"day", "kind", "category", "amount"})
        self.add(note="<script>alert(1)</script>")
        html, _ = self.report()
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)


if __name__ == "__main__":
    unittest.main()
