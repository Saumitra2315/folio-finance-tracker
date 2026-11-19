const select = (selector, root = document) => root.querySelector(selector);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];

const seed = select("#website-seed");
const website = seed
	? (await import("./website.mjs")).openWebsite(JSON.parse(seed.textContent))
	: null;

for (const opener of all("[data-open]")) {
	opener.addEventListener("click", () =>
		document.getElementById(opener.dataset.open).showModal(),
	);
}
for (const closer of all("[data-close]")) {
	closer.addEventListener("click", () => closer.closest("dialog").close());
}

const navLinks = all(".nav a");
function markSection() {
	const selected =
		navLinks.find((link) => link.hash === location.hash) || navLinks[0];
	for (const link of navLinks) {
		if (link === selected) link.setAttribute("aria-current", "location");
		else link.removeAttribute("aria-current");
	}
}
window.addEventListener("hashchange", markSection);
markSection();

const tx = select("#transaction-dialog form");
function matchCategories() {
	for (const option of all("option[data-kind]", tx)) {
		option.hidden = option.disabled =
			option.dataset.kind !== tx.elements.kind.value;
	}
	if (tx.elements.category.selectedOptions[0]?.disabled)
		tx.elements.category.value = "";
}
tx.elements.kind.addEventListener("change", matchCategories);
matchCategories();

const dateRange = select("#date-dialog form");
function checkDates() {
	dateRange.elements.end.min = dateRange.elements.start.value;
}
dateRange.elements.start.addEventListener("input", checkDates);
checkDates();

for (const form of all("form[data-save]")) {
	const button = select("button[type=submit], .submit", form);
	const errors = all("[data-error]", form);
	for (const error of errors) {
		const input = form.elements.namedItem(error.dataset.error);
		if (input) {
			error.id = `${form.closest("dialog").id}-${input.name}-error`;
			input.setAttribute("aria-describedby", error.id);
		}
	}
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (button.disabled) return;
		button.disabled = true;
		for (const error of errors) error.textContent = "";
		for (const input of all("[aria-invalid]", form))
			input.removeAttribute("aria-invalid");
		try {
			const values = Object.fromEntries(new FormData(form));
			let problems;
			if (website) {
				problems = website.save(form === tx, values);
			} else {
				const response = await fetch(form.action, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(values),
				});
				if (!response.ok) {
					problems = (await response.json()).errors;
					if (!problems) throw new Error("Unexpected response");
				}
			}
			if (problems) {
				for (const error of errors) {
					const key = error.dataset.error;
					if (problems[key]) {
						error.textContent = problems[key];
						form.elements.namedItem(key)?.setAttribute("aria-invalid", "true");
					}
				}
				select("[aria-invalid]", form)?.focus();
				button.disabled = false;
				return;
			}
			let message = form === tx ? "Transaction saved." : "Budget saved.";
			if (
				form === tx &&
				(values.day < dateRange.elements.start.value ||
					values.day > dateRange.elements.end.value)
			) {
				message += " Its date is outside the selected period.";
			}
			if (form !== tx && values.month !== dateRange.elements.month.value) {
				message += " Select its month to view it.";
			}
			sessionStorage.setItem("folio-message", message);
			location.reload();
		} catch {
			select('[data-error="form"]', form).textContent =
				"Could not confirm the save. Check your ledger before retrying.";
			button.disabled = false;
		}
	});
}
const message = sessionStorage.getItem("folio-message");
if (message) {
	const toast = select("#toast");
	toast.hidden = false;
	toast.textContent = message;
	sessionStorage.removeItem("folio-message");
	window.setTimeout(() => {
		toast.hidden = true;
	}, 5500);
}

const { trend, expenses } =
	website?.report ?? JSON.parse(select("#chart-data").textContent);
if (expenses.length > 0) {
	const inr = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: "INR",
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	});
	const monthName = new Intl.DateTimeFormat("en-IN", {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	const styles = getComputedStyle(document.documentElement);
	const palette = expenses.map((_, i) =>
		styles.getPropertyValue(`--c${i}`).trim(),
	);
	Chart.defaults.font.family = styles.fontFamily;
	Chart.defaults.color = "#6b6673";
	Chart.defaults.animation = !matchMedia("(prefers-reduced-motion: reduce)")
		.matches;
	const noLegend = { display: false };
	const trendCanvas = select("#trend");
	const fill = trendCanvas.getContext("2d").createLinearGradient(0, 0, 0, 190);
	fill.addColorStop(0, "rgba(137, 85, 205, 0.23)");
	fill.addColorStop(1, "rgba(137, 85, 205, 0.01)");
	new Chart(trendCanvas, {
		type: "line",
		data: {
			labels: trend.map((row) =>
				monthName.format(new Date(`${row.month}-01T00:00:00Z`)),
			),
			datasets: [
				{
					label: "Expenses",
					data: trend.map((row) => row.paise / 100),
					borderColor: palette[0],
					backgroundColor: fill,
					fill: true,
					borderWidth: 2.5,
					pointRadius: trend.length < 20 ? 4 : 0,
					pointHoverRadius: 6,
					pointBorderWidth: 2,
					pointBorderColor: palette[0],
					pointBackgroundColor: "#fff",
				},
			],
		},
		options: {
			maintainAspectRatio: false,
			interaction: { mode: "index", intersect: false },
			plugins: {
				legend: noLegend,
				tooltip: {
					callbacks: {
						label: (ctx) => `Expenses: ${inr.format(ctx.parsed.y)}`,
					},
				},
			},
			scales: {
				x: {
					offset: trend.length === 1,
					grid: { display: false },
					border: { display: false },
					ticks: { maxTicksLimit: 8 },
				},
				y: {
					beginAtZero: true,
					grace: "8%",
					border: { display: false },
					grid: { color: "#eceaf0" },
					ticks: { maxTicksLimit: 5, callback: (value) => inr.format(value) },
				},
			},
		},
	});
	new Chart(select("#pie"), {
		type: "pie",
		data: {
			labels: expenses.map((row) => row.category),
			datasets: [
				{
					data: expenses.map((row) => row.paise / 100),
					backgroundColor: palette,
					borderWidth: 3,
					borderColor: "#fff",
					hoverOffset: 4,
				},
			],
		},
		options: {
			maintainAspectRatio: false,
			layout: { padding: 5 },
			plugins: {
				legend: noLegend,
				tooltip: {
					callbacks: {
						label: (ctx) => `${ctx.label}: ${inr.format(ctx.parsed)}`,
					},
				},
			},
		},
	});
}
