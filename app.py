import calendar
import csv
import io
import os
import re
import sqlite3
from datetime import date
from pathlib import Path

import click
from flask import Flask, Response, g, jsonify, render_template, request, url_for


def iso_day(value):
    if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    return None


def valid_month(value):
    return isinstance(value, str) and iso_day(value + "-01") is not None


def parse_paise(value):
    # Accept decimal text at the boundary so a binary float never enters the ledger.
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{1,12}(?:\.[0-9]{1,2})?", value
    ):
        return None
    whole, _, fraction = value.partition(".")
    return (int(whole) * 100 + int(fraction.ljust(2, "0"))) or None


def decimal_amount(paise):
    return f"{paise // 100}.{paise % 100:02}"


def money(paise):
    digits = str(abs(paise) // 100)
    prefix, last = digits[:-3], digits[-3:]
    groups = []
    while prefix:
        groups.append(prefix[-2:])
        prefix = prefix[:-2]
    whole = ",".join([*reversed(groups), last])
    remainder = abs(paise) % 100
    return (
        ("−" if paise < 0 else "")
        + "₹"
        + whole
        + (f".{remainder:02}" if remainder else "")
    )


def filters(today):
    last = calendar.monthrange(today.year, today.month)[1]
    start = request.args.get("start", today.replace(day=1).isoformat())
    end = request.args.get("end", today.replace(day=last).isoformat())
    errors = {}
    if not iso_day(start):
        errors["start"] = "Enter a valid start date."
    if not iso_day(end):
        errors["end"] = "Enter a valid end date."
    if not errors and end < start:
        errors["end"] = "End date must be on or after the start date."
    return start, end, errors


def ledger(db, start, end):
    return db.execute(
        """SELECT t.*, c.kind FROM transactions t JOIN categories c ON c.name=t.category
           WHERE day BETWEEN ? AND ? ORDER BY day DESC, id DESC""",
        (start, end),
    ).fetchall()


def expense_summary(rows):
    totals = {}
    for row in rows:
        if row["kind"] == "expense":
            category = row["category"]
            item = totals.setdefault(
                category, {"category": category, "count": 0, "paise": 0}
            )
            item["count"] += 1
            item["paise"] += row["paise"]
    return sorted(totals.values(), key=lambda item: (-item["paise"], item["category"]))


def monthly_trend(start, end, rows):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    totals = {}
    for index in range(first.year * 12 + first.month - 1, last.year * 12 + last.month):
        year, month = divmod(index, 12)
        totals[f"{year:04}-{month + 1:02}"] = 0
    for row in rows:
        if row["kind"] == "expense":
            totals[row["day"][:7]] += row["paise"]
    return [{"month": key, "paise": value} for key, value in totals.items()]


def budget_cards(db, month):
    caps = dict(
        db.execute("SELECT category, paise FROM budgets WHERE month=?", (month,))
    )
    year, number = map(int, month.split("-"))
    last = calendar.monthrange(year, number)[1]
    spent = {
        item["category"]: item["paise"]
        for item in expense_summary(ledger(db, month + "-01", f"{month}-{last:02}"))
    }
    cards = []
    for category in sorted(caps.keys() | spent.keys()):
        cap, used = caps.get(category), spent.get(category, 0)
        status, tone, percent = "No budget set", "neutral", None
        if cap:
            if used > cap:
                status, tone = "Over budget", "over"
            elif used == cap:
                status, tone = "At limit", "limit"
            elif used * 100 >= cap * 80:
                status, tone = "Nearing limit", "near"
            else:
                status, tone = "On track", "good"
            # Truncate separately for display so a sub-threshold value never rounds up.
            hundredths = used * 10000 // cap
            percent = decimal_amount(hundredths).rstrip("0").rstrip(".")
        cards.append(
            {
                "category": category,
                "cap": cap,
                "used": used,
                "status": status,
                "tone": tone,
                "percent": percent,
            }
        )
    return cards


def create_app(database=None):
    app = Flask(__name__)
    path = Path(
        database
        or os.environ.get("FOLIO_DB")
        or Path(app.instance_path) / "folio.sqlite3"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    app.config.update(
        MAX_CONTENT_LENGTH=32 * 1024, TRUSTED_HOSTS=["localhost", "127.0.0.1", "[::1]"]
    )
    app.add_template_filter(money)
    app.add_template_filter(
        lambda s: date.fromisoformat(s).strftime("%d %b %Y").lstrip("0"), "pretty_date"
    )
    app.add_template_filter(
        lambda s: date.fromisoformat(s + "-01").strftime("%B %Y"), "pretty_month"
    )

    def connection():
        if "db" not in g:
            g.db = sqlite3.connect(path)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys=ON")
        return g.db

    @app.teardown_appcontext
    def close_connection(_error):
        if "db" in g:
            g.db.close()

    with app.app_context(), connection() as db:
        db.executescript(Path(app.root_path, "schema.sql").read_text())

    @app.get("/")
    def dashboard():
        today = date.today()
        start, end, errors = filters(today)
        month = request.args.get("month", today.isoformat()[:7])
        if not valid_month(month):
            errors["month"] = "Enter a valid budget month."
        if errors:
            return render_template(
                "invalid.html", errors=errors, start=start, end=end, month=month
            ), 400
        db = connection()
        db.execute("BEGIN")
        rows = ledger(db, start, end)
        categories = db.execute("SELECT * FROM categories ORDER BY name").fetchall()
        expenses = expense_summary(rows)
        income = sum(row["paise"] for row in rows if row["kind"] == "income")
        spend = sum(item["paise"] for item in expenses)
        return render_template(
            "dashboard.html",
            rows=rows,
            categories=categories,
            expenses=expenses,
            income=income,
            spend=spend,
            income_count=sum(row["kind"] == "income" for row in rows),
            trend=monthly_trend(start, end, rows),
            budgets=budget_cards(db, month),
            start=start,
            end=end,
            month=month,
            today=today.isoformat(),
        )

    @app.post("/transactions", endpoint="save_transaction")
    @app.post("/budgets", endpoint="save_budget")
    def save():
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify(errors={"form": "Expected a JSON object."}), 400
        is_budget = request.endpoint == "save_budget"
        errors = {}
        kind = "expense" if is_budget else data.get("kind")
        if kind not in ("income", "expense"):
            errors["kind"] = "Choose income or expense."
        category = data.get("category")
        db = connection()
        if (
            not isinstance(category, str)
            or not db.execute(
                "SELECT 1 FROM categories WHERE name=? AND kind=?",
                (category, kind if isinstance(kind, str) else ""),
            ).fetchone()
        ):
            errors["category"] = "Choose a category that matches this type."
        paise = parse_paise(data.get("amount"))
        if paise is None:
            errors["amount"] = (
                "Enter a positive amount with up to 12 whole digits and two decimal places."
            )
        if is_budget:
            if not valid_month(data.get("month")):
                errors["month"] = "Enter a valid budget month."
        else:
            if not iso_day(data.get("day")):
                errors["day"] = "Enter a valid transaction date."
            note = data.get("note", "")
            if not isinstance(note, str) or len(note) > 500:
                errors["note"] = "Use a note of 500 characters or fewer."
        if errors:
            return jsonify(errors=errors), 422
        with db:
            if is_budget:
                db.execute(
                    """INSERT INTO budgets VALUES (?, ?, ?) ON CONFLICT(month, category)
                              DO UPDATE SET paise=excluded.paise""",
                    (data["month"], category, paise),
                )
            else:
                db.execute(
                    "INSERT INTO transactions(day, category, paise, note) VALUES (?, ?, ?, ?)",
                    (data["day"], category, paise, note.strip()),
                )
        return jsonify(saved=True), 200 if is_budget else 201

    @app.get("/exports/<fmt>")
    def export(fmt):
        if fmt not in ("csv", "json"):
            return jsonify(error="Choose CSV or JSON."), 404
        start, end, errors = filters(date.today())
        if errors:
            return jsonify(errors=errors), 400
        fields = ("category", "transaction_count", "total_inr")
        records = [
            dict(
                zip(
                    fields,
                    (item["category"], item["count"], decimal_amount(item["paise"])),
                    strict=True,
                )
            )
            for item in expense_summary(ledger(connection(), start, end))
        ]
        if fmt == "json":
            response = jsonify(records)
        else:
            buffer = io.StringIO(newline="")
            writer = csv.DictWriter(buffer, fieldnames=fields)
            writer.writeheader()
            writer.writerows(records)
            response = Response(buffer.getvalue(), mimetype="text/csv")
        response.headers["Content-Disposition"] = (
            f'attachment; filename="expenses-{start}-to-{end}.{fmt}"'
        )
        return response

    @app.cli.command("seed-demo")
    def seed_demo():
        """Load the fictional Sep–Nov 2026 walkthrough into an empty database."""
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute(
                "SELECT 1 FROM transactions UNION ALL SELECT 1 FROM budgets LIMIT 1"
            ).fetchone():
                raise click.ClickException(
                    "Demo requires an empty database. Choose a new FOLIO_DB path."
                )
            db.executemany(
                "INSERT INTO transactions(day,category,paise,note) VALUES (?,?,?,?)",
                [
                    ("2026-09-12", "Groceries", 60000, "September market"),
                    ("2026-11-01", "Salary", 1000000, "November salary"),
                    ("2026-11-05", "Groceries", 70000, "Weekly groceries"),
                    ("2026-11-09", "Transport", 30000, "Metro pass"),
                ],
            )
            db.execute("INSERT INTO budgets VALUES ('2026-11','Groceries',100000)")
        with app.test_request_context():
            click.echo(
                "Demo dashboard path: "
                + url_for(
                    "dashboard", start="2026-11-01", end="2026-11-30", month="2026-11"
                )
            )

    return app
