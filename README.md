# Folio personal finance tracker

Folio tracks income, expenses and monthly category budgets in INR. The hosted website saves entries in your browser. The optional Flask edition saves them in a local SQLite database. Both use the bundled Chart.js 4.4.9 charts and can export category expense summaries as CSV or JSON.

## Hosted website

The website opens with fictional November demo entries. It stores subsequent transactions and budget caps in that browser's local storage. Those entries stay on that device, and clearing site data removes them. The Flask edition uses its own SQLite file.

To build the website, run `.venv/bin/python build_website.py` from this directory. Serve the resulting `dist/` directory at the root of any static web host. The build creates a temporary seeded database and never reads a personal ledger. Run the browser-calculation checks with `node --test tests/website.test.mjs`.

## Run locally

Open a terminal in the directory containing `app.py`. Use Python 3.11 or newer.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/flask --app app run --host 127.0.0.1 --port 5050
```

Open [Folio](http://127.0.0.1:5050/). The app creates an empty ledger in `instance/folio.sqlite3`. It opens on the current month. Use **Add transaction** to enter an income or expense and **Set budget** to choose a monthly expense cap. Entries persist when Flask restarts.

## Classroom demo

Stop the personal server first if it occupies port 5050. In the same terminal, from the application directory, run the following commands. Seeding requires an empty database. To resume an existing demo, run just the export and server commands. A fresh path such as `instance/demo-2.sqlite3` starts a new walkthrough.

```sh
export FOLIO_DB="$PWD/instance/demo.sqlite3"
.venv/bin/flask --app app seed-demo
.venv/bin/flask --app app run --host 127.0.0.1 --port 5050
```

Open the [November walkthrough](http://127.0.0.1:5050/?start=2026-11-01&end=2026-11-30&month=2026-11). Use `unset FOLIO_DB` before restarting to return to the personal ledger.

| Step | Action | Observable result |
| --- | --- | --- |
| 1 | Inspect the seeded November dashboard. | ₹10,000 income, ₹1,000 expenses, ₹9,000 net. Groceries have used 70% of a ₹1,000 budget. Transport has no cap. |
| 2 | Add ₹100 of Groceries on November 15, 2026. | The grocery card reaches 80% and shows **Nearing limit**. |
| 3 | Add ₹250 of Groceries on the same date. Reload the page. | Both entries persist. Groceries show 105% used and ₹50 over budget. November expenses total ₹1,350 and net balance is ₹8,650. |
| 4 | Set both dates in **Date range** to November 15. | The ledger contains the two new entries. The pie shows ₹350 of groceries. The November budget card still counts ₹1,050. |
| 5 | Select September 1 through November 30, 2026. Hover or tap the charts and download both formats from **Export**. | Monthly spending is ₹600, ₹0, and ₹1,350. Each file reports groceries ₹1,650 (four entries) and transport ₹300 (one entry). The categories sum to ₹1,950. |

## Requirements and business rules

| Requirement | Behavior |
| --- | --- |
| FR-01 · Transactions | Each entry requires a valid calendar date, income or expense type, matching predefined category and positive INR amount. Amounts accept up to 12 whole digits and two decimal places. Notes are optional, up to 500 characters. Invalid entries return field-specific errors and save nothing. |
| FR-02 · Ledger | Both date endpoints are inclusive. A reversed range is invalid. The ledger shows newest dates first and calculates income, expenses and net balance for that range. |
| FR-03 · Budgets | A positive cap applies to one expense category and calendar month. Saving the same pair replaces that cap. The budget month selector is independent of the ledger filter. Budget cards show categories with a cap or actual spending that month. |
| FR-04 · Warnings | Below 80% is **On track**, 80% to below 100% is **Nearing limit**, exactly 100% is **At limit** and above 100% is **Over budget**. Overspending is saved and the excess is shown. A spending category without a cap shows **No budget set**. |
| FR-05 · Analytics | The pie groups expenses by category. The trend sums spending by calendar month inside the selected dates, including intermediate months with no spending. Exact amounts are available in tooltips, the pie legend and the monthly amounts table. An expense-free period shows an empty state. |
| FR-06 · Export | The JSON array and CSV file both contain one record per spending category with `category`, `transaction_count` and `total_inr`. The amount is a decimal string with two places. An empty interval returns an empty array or a header-only CSV. |

## How the calculation works

A transaction form sends JSON to Flask. Flask checks the category against the predefined list, converts decimal text to integer paise and writes one SQLite row. The transaction stores a category reference, so its income or expense type comes from that category. The dashboard and both export routes share the filtered ledger and expense aggregation code in `app.py`. Chart.js draws the totals Flask supplies. Monthly budgets retrieve the full month separately, so narrowing the ledger cannot hide an overspend.

For example, ₹799.99 is 79,999 paise. For a ₹1,000 cap, the 80% comparison is `79999 × 100 >= 100000 × 80`, which is false. An additional ₹0.01 moves the category to **Nearing limit**. Status uses the exact integers before formatting the percentage for display.

## Checks

Run the integration tests from the application directory. They create temporary databases, exercise the classroom walkthrough, and reopen the database to check persistence.

```sh
.venv/bin/python -m unittest discover -s tests -v
```

For development checks, install Ruff into the same virtual environment and run:

```sh
.venv/bin/python -m pip install ruff
.venv/bin/ruff format --check app.py tests
.venv/bin/ruff check app.py tests
node --check static/dashboard.js
```

The database contains local financial records in plain SQLite. Keep the server bound to loopback and use fictional data for presentations.
