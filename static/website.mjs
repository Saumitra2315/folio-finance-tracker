// The hosted version uses the same forms and charts, with one browser-storage key per entry.
const prefix = "folio:v1:";
const months = new Intl.DateTimeFormat("en-IN", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const days = new Intl.DateTimeFormat("en-IN", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});
const formatDay = (day) => days.format(new Date(`${day}T00:00:00Z`));
const formatMonth = (month) => months.format(new Date(`${month}-01T00:00:00Z`));
const decimal = (n) => `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
function money(n) {
	const positive = n < 0n ? -n : n;
	const fraction = positive % 100n;
	return `${n < 0n ? "−" : ""}₹${(positive / 100n).toLocaleString("en-IN")}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}`;
}
const html = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
function validDay(day) {
	if (
		typeof day !== "string" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
		day.startsWith("0000")
	)
		return false;
	const parsed = new Date(`${day}T00:00:00Z`);
	return (
		Number.isFinite(parsed.valueOf()) &&
		parsed.toISOString().slice(0, 10) === day
	);
}
function nextMonth(month) {
	const [y, m] = month.split("-").map(Number);
	return m === 12
		? `${String(y + 1).padStart(4, "0")}-01`
		: month.slice(0, 5) + String(m + 1).padStart(2, "0");
}

export function summarize(rows, budgets, start, end, month) {
	const ledger = rows
		.filter((t) => t.day >= start && t.day <= end)
		.reverse()
		.sort((a, b) => b.day.localeCompare(a.day));
	const groups = new Map(),
		monthly = new Map(),
		cards = new Map();
	for (let m = start.slice(0, 7); ; m = nextMonth(m)) {
		monthly.set(m, 0n);
		if (m === end.slice(0, 7)) break;
	}
	let income = 0n,
		spend = 0n,
		incomeCount = 0;
	for (const row of ledger) {
		const n = BigInt(row.paise);
		if (row.kind === "income") {
			income += n;
			incomeCount++;
			continue;
		}
		spend += n;
		const m = row.day.slice(0, 7);
		monthly.set(m, monthly.get(m) + n);
		const group = groups.get(row.category) ?? {
			category: row.category,
			count: 0,
			amount: 0n,
		};
		group.count++;
		group.amount += n;
		groups.set(row.category, group);
	}
	for (const row of budgets.filter((b) => b.month === month))
		cards.set(row.category, { cap: BigInt(row.paise), used: 0n });
	for (const row of rows) {
		if (row.kind !== "expense" || row.day.slice(0, 7) !== month) continue;
		const card = cards.get(row.category) ?? { cap: 0n, used: 0n };
		card.used += BigInt(row.paise);
		cards.set(row.category, card);
	}
	const expenses = [...groups.values()].sort((a, b) =>
		a.amount === b.amount
			? a.category.localeCompare(b.category)
			: a.amount > b.amount
				? -1
				: 1,
	);
	return { ledger, income, spend, incomeCount, expenses, cards, monthly };
}

export function budgetStatus(used, cap) {
	if (!cap) return ["No budget set", "neutral"];
	if (used > cap) return ["Over budget", "over"];
	if (used === cap) return ["At limit", "limit"];
	if (used * 100n >= cap * 80n) return ["Nearing limit", "near"];
	return ["On track", "good"];
}

export function saveEntry(storage, isTransaction, values, categories) {
	const errors = {};
	if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(values.amount ?? ""))
		errors.amount =
			"Enter a positive INR amount with up to two decimal places.";
	const [whole, part = ""] = String(values.amount ?? "").split(".");
	const paise = Number(whole) * 100 + Number(part.padEnd(2, "0"));
	if (!Number.isSafeInteger(paise) || paise < 1)
		errors.amount =
			"Enter a positive INR amount with up to two decimal places.";
	const kind = isTransaction ? values.kind : "expense";
	if (!["income", "expense"].includes(kind))
		errors.kind = "Choose income or expense.";
	if (categories.get(values.category) !== kind)
		errors.category = "Choose a matching category.";
	if (isTransaction && !validDay(values.day))
		errors.day = "Enter a valid date.";
	if (isTransaction && (values.note ?? "").length > 500)
		errors.note = "Use up to 500 characters.";
	if (!isTransaction && !validDay(`${values.month}-01`))
		errors.month = "Enter a valid budget month.";
	if (Object.keys(errors).length) return errors;
	const category = values.category;
	const key = isTransaction
		? `tx:${Date.now()}:${crypto.randomUUID()}`
		: `cap:${values.month}:${category}`;
	const record = isTransaction
		? {
				day: values.day,
				category,
				kind,
				paise,
				note: (values.note ?? "").trim(),
			}
		: { month: values.month, category, paise };
	try {
		storage.setItem(prefix + key, JSON.stringify(record));
	} catch {
		return {
			form: "Browser storage is unavailable or full. Your entry could not be saved.",
		};
	}
	return null;
}

export function openWebsite(seed) {
	const el = (selector) => document.querySelector(selector);
	const dateForm = el("#date-dialog form"),
		budgetForm = el("#budget-dialog form"),
		tx = el("#transaction-dialog form");
	const query = new URLSearchParams(location.search);
	let start = query.get("start") ?? dateForm.elements.start.value,
		end = query.get("end") ?? dateForm.elements.end.value;
	let month = query.get("month") ?? dateForm.elements.month.value;
	function notice(text) {
		const node = el("#toast");
		node.hidden = false;
		node.textContent = text;
	}
	if (
		!validDay(start) ||
		!validDay(end) ||
		start > end ||
		!validDay(`${month}-01`)
	) {
		start = dateForm.elements.start.value;
		end = dateForm.elements.end.value;
		month = dateForm.elements.month.value;
		notice("Invalid dates. Showing the November 2026 demo period.");
	}
	const categories = new Map(
		[...tx.elements.category.options]
			.filter((o) => o.dataset.kind)
			.map((o) => [o.value, o.dataset.kind]),
	);
	const rows = [...seed.transactions],
		caps = [...seed.budgets];
	let storage;
	try {
		storage = window.localStorage;
		for (const key of Object.keys(storage)
			.filter((k) => k.startsWith(prefix))
			.sort()) {
			const record = JSON.parse(storage.getItem(key));
			if (!record || !Number.isSafeInteger(record.paise) || record.paise <= 0)
				continue;
			if (
				key.startsWith(`${prefix}tx:`) &&
				validDay(record.day) &&
				categories.has(record.category) &&
				categories.get(record.category) === record.kind
			)
				rows.push(record);
			if (
				key.startsWith(`${prefix}cap:`) &&
				validDay(`${record.month}-01`) &&
				categories.get(record.category) === "expense"
			)
				caps.push(record);
		}
	} catch {
		notice(
			"Browser storage could not be read. The fictional demo is available.",
		);
	}
	const s = summarize(rows, caps, start, end, month);
	const period = `${formatDay(start)} – ${formatDay(end)}`;
	el(".brand").setAttribute("href", location.pathname);
	el(".period").textContent = period;
	el(".export-period").textContent = period;
	for (const form of [dateForm, el("#month-dialog form")]) {
		form.elements.start.value = start;
		form.elements.end.value = end;
		form.elements.month.value = month;
	}
	budgetForm.elements.month.value = month;
	el(".month-button").firstChild.textContent = `${formatMonth(month)} `;
	const now = new Date();
	const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 10);
	tx.elements.day.value = today >= start && today <= end ? today : end;
	el(".balance strong").textContent = money(s.income - s.spend);
	const count = (n) => `${n} transaction${n === 1 ? "" : "s"}`;
	for (const [label, amount, n] of [
		["income", s.income, s.incomeCount],
		["expense", s.spend, s.ledger.length - s.incomeCount],
	]) {
		el(`.stat.${label} strong`).textContent = money(amount);
		el(`.stat.${label} p`).textContent = count(n);
	}
	el("#transactions .panel-heading p").textContent =
		s.ledger.length +
		" " +
		(s.ledger.length === 1 ? "entry" : "entries") +
		" in this period";
	const tbody = el("#transactions tbody");
	tbody.innerHTML =
		s.ledger
			.map(
				(r) =>
					`<tr><td><strong>${html(r.category)}</strong><small>${html(r.note ?? "")}</small></td><td class="date-cell">${formatDay(r.day)}</td><td><span class="type ${r.kind}">${r.kind === "income" ? "Income" : "Expense"}</span></td><td class="numeric tx-amount ${r.kind}">${r.kind === "income" ? "+" : "−"}${money(BigInt(r.paise))}</td></tr>`,
			)
			.join("") ||
		'<tr><td colspan="4">No transactions in this period</td></tr>';
	const budgetPanel = el("#budgets");
	for (const card of budgetPanel.querySelectorAll(".budget-row")) card.remove();
	const cards = [...s.cards].sort(([a], [b]) => a.localeCompare(b));
	for (const [category, { used, cap }] of cards) {
		const [status, tone] = budgetStatus(used, cap);
		const percent = cap
			? decimal((used * 10000n) / cap).replace(/\.?0+$/, "")
			: "";
		const progress = cap
			? `<div class="track" aria-hidden="true"><i style="width:${Math.min(100, Number(percent))}%"></i></div><small>${percent || 0}% used${used > cap ? ` · ${money(used - cap)} over budget` : ""}</small>`
			: "";
		budgetPanel.insertAdjacentHTML(
			"beforeend",
			`<div class="budget-row ${tone}"><div class="budget-head"><strong>${html(category)}</strong><span class="status">${status}</span></div><p><b>${money(used)}</b> ${cap ? `of ${money(cap)}` : "spent"}</p>${progress}</div>`,
		);
	}
	if (!cards.length)
		budgetPanel.insertAdjacentHTML(
			"beforeend",
			'<div class="empty">No budgets or spending this month</div>',
		);
	const expenses = s.expenses.map((r) => ({
		category: r.category,
		count: r.count,
		paise: Number(r.amount),
	}));
	const trend = [...s.monthly].map(([m, v]) => ({
		month: m,
		paise: Number(v),
	}));
	if (expenses.length) {
		el(".pie-legend").innerHTML = s.expenses
			.map(
				(r, i) =>
					`<li><i class="swatch c${i}"></i><span>${html(r.category)}<strong>${money(r.amount)}</strong></span></li>`,
			)
			.join("");
		el(".chart-table tbody").innerHTML = [...s.monthly]
			.map(
				([m, v]) => `<tr><td>${formatMonth(m)}</td><td>${money(v)}</td></tr>`,
			)
			.join("");
	} else {
		for (const selector of [".plot", ".chart-table", ".breakdown"])
			el(selector).hidden = true;
		for (const panel of document.querySelectorAll(".chart-panel"))
			panel.insertAdjacentHTML(
				"beforeend",
				'<div class="empty chart-empty">No expenses in this period</div>',
			);
	}
	const records = s.expenses.map((r) => ({
		category: r.category,
		transaction_count: r.count,
		total_inr: decimal(r.amount),
	}));
	for (const link of document.querySelectorAll(".export-options a")) {
		const csv = link.pathname.endsWith("/csv"),
			fmt = csv ? "csv" : "json";
		const content = csv
			? `${[
					"category,transaction_count,total_inr",
					...records.map((r) =>
						[r.category, r.transaction_count, r.total_inr].join(","),
					),
				].join("\r\n")}\r\n`
			: JSON.stringify(records, null, 2);
		link.href = URL.createObjectURL(
			new Blob([content], {
				type: csv ? "text/csv;charset=utf-8" : "application/json",
			}),
		);
		link.download = `expenses-${start}-to-${end}.${fmt}`;
	}
	return {
		report: { expenses, trend },
		save: (isTx, v) => saveEntry(storage, isTx, v, categories),
	};
}
