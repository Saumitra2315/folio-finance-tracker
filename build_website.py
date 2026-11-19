"""Build a static website from Folio's templates and fictional classroom fixture."""

import shutil
import sqlite3
import tempfile
from pathlib import Path

from app import create_app


def build(output):
    root = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "demo.sqlite3"
        app = create_app(db_path)
        result = app.test_cli_runner().invoke(args=["seed-demo"])
        if result.exit_code:
            raise RuntimeError(result.output) from result.exception
        with sqlite3.connect(db_path) as db:
            db.row_factory = sqlite3.Row
            transactions = db.execute(
                "SELECT day, category, kind, paise, note FROM transactions "
                "JOIN categories ON name=category ORDER BY id"
            ).fetchall()
            caps = db.execute("SELECT month, category, paise FROM budgets").fetchall()
            app.config["WEBSITE_SEED"] = {
                "transactions": list(map(dict, transactions)),
                "budgets": list(map(dict, caps)),
            }
        response = app.test_client().get(
            "/?start=2026-11-01&end=2026-11-30&month=2026-11"
        )
        if response.status_code != 200:
            raise RuntimeError("Could not render the website")
        output.mkdir(parents=True, exist_ok=True)
        # Only UI assets and a page rendered from the new demo DB enter the website.
        shutil.copytree(root / "static", output / "static", dirs_exist_ok=True)
        (output / "index.html").write_bytes(response.data)


if __name__ == "__main__":
    build(Path(__file__).resolve().parent / "dist")
