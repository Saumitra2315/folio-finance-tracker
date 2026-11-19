import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatus, saveEntry, summarize } from "../static/website.mjs";

const categories = new Map([
	["Groceries", "expense"],
	["Transport", "expense"],
	["Salary", "income"],
]);
const entry = {
	day: "2026-11-15",
	kind: "expense",
	category: "Groceries",
	note: "",
	amount: "100",
};

test("save validates before writing and preserves individual entries across repeated amounts", () => {
	const data = new Map();
	const store = { setItem: (key, value) => data.set(key, JSON.parse(value)) };
	for (const values of [
		{ amount: "0" },
		{ amount: "1.005" },
		{ day: "2026-02-29" },
		{ category: "Salary" },
	])
		assert.ok(saveEntry(store, true, { ...entry, ...values }, categories));
	assert.equal(data.size, 0);
	assert.equal(saveEntry(store, true, entry, categories), null);
	assert.equal(
		saveEntry(store, true, { ...entry, amount: "0.01" }, categories),
		null,
	);
	assert.equal(data.size, 2);
	assert.deepEqual(
		[...data.values()].map((r) => r.paise),
		[10000, 1],
	);
	const cap = { category: "Groceries", month: "2026-11", amount: "1000" };
	saveEntry(store, false, cap, categories);
	saveEntry(store, false, { ...cap, amount: "500" }, categories);
	assert.equal(data.size, 3);
	assert.equal([...data.values()].at(-1).paise, 50000);
	assert.ok(saveEntry(null, true, entry, categories).form);
});

test("full-month budgets and chart/export sums match the November walkthrough", () => {
	const rows = [
		{ day: "2026-09-12", category: "Groceries", paise: 60000, kind: "expense" },
		{ day: "2026-11-01", category: "Salary", paise: 1000000, kind: "income" },
		{ day: "2026-11-05", category: "Groceries", paise: 70000, kind: "expense" },
		{ day: "2026-11-09", category: "Transport", paise: 30000, kind: "expense" },
		{ ...entry, paise: 10000 },
		{ ...entry, paise: 25000 },
	];
	const caps = [{ month: "2026-11", category: "Groceries", paise: 100000 }];
	const day = summarize(rows, caps, "2026-11-15", "2026-11-15", "2026-11");
	assert.equal(day.spend, 35000n);
	assert.equal(day.cards.get("Groceries").used, 105000n);
	const all = summarize(rows, caps, "2026-09-01", "2026-11-30", "2026-11");
	assert.deepEqual([...all.monthly.values()], [60000n, 0n, 135000n]);
	assert.equal(all.income - all.spend, 805000n);
	assert.deepEqual(all.expenses, [
		{ category: "Groceries", count: 4, amount: 165000n },
		{ category: "Transport", count: 1, amount: 30000n },
	]);
	for (const [n, status] of [
		[79999n, "On track"],
		[80000n, "Nearing limit"],
		[100000n, "At limit"],
		[100001n, "Over budget"],
	])
		assert.equal(budgetStatus(n, 100000n)[0], status);
	assert.equal(budgetStatus(100000n, 0n)[0], "No budget set");
	const empty = summarize(rows, caps, "2026-12-31", "2027-01-01", "2026-12");
	assert.deepEqual([...empty.monthly.keys()], ["2026-12", "2027-01"]);
	assert.equal(empty.expenses.length, 0);
});
