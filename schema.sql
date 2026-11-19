CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense'))
);

INSERT OR IGNORE INTO categories (name, kind) VALUES
    ('Salary', 'income'), ('Freelance', 'income'), ('Other income', 'income'),
    ('Groceries', 'expense'), ('Transport', 'expense'), ('Dining', 'expense'),
    ('Shopping', 'expense'), ('Bills', 'expense'), ('Health', 'expense'),
    ('Leisure', 'expense'), ('Other expenses', 'expense');

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories(name),
    paise INTEGER NOT NULL CHECK (paise > 0),
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS transaction_day ON transactions(day);

CREATE TABLE IF NOT EXISTS budgets (
    month TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories(name),
    paise INTEGER NOT NULL CHECK (paise > 0),
    PRIMARY KEY (month, category)
);
