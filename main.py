from contextlib import contextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, field_validator
import sqlite3
import os
import csv
import io
import re
from datetime import datetime

app = FastAPI()

DB = os.path.join(os.path.dirname(__file__), "finance.db")

VALID_TYPES = ("receita", "expense")
VALID_CATEGORIES = {
    "receita": {"color": "#22c55e", "icons": {"Salary": "Sal\u00e1rio", "Investments": "Investimentos", "Freelance": "Freelance", "Other": "Outro"}},
    "expense": {"color": "#ef4444", "icons": {"Food": "Alimenta\u00e7\u00e3o", "Transport": "Transporte", "Housing": "Moradia", "Health": "Sa\u00fade", "Entertainment": "Lazer", "Shopping": "Compras", "Education": "Educa\u00e7\u00e3o", "Other": "Outro"}},
}

# Whitelist of allowed column names for UPDATE — prevents any injection
ALLOWED_COLUMNS = {"description", "amount", "date", "category", "type"}


@contextmanager
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT CHECK(type IN ('receita', 'expense')),
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                date TEXT NOT NULL,
                recurring_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS budgets (
                category TEXT PRIMARY KEY,
                amount REAL NOT NULL
            )"""
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS recurring (
                id TEXT PRIMARY KEY,
                type TEXT CHECK(type IN ('receita', 'expense')),
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                day INTEGER NOT NULL
            )"""
        )
        conn.commit()


init_db()


def _validate_date(date_str: str) -> str:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        raise HTTPException(400, "Formato de data inv\u00e1lido. Use YYYY-MM-DD")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Data inv\u00e1lida")
    return date_str


class Transaction(BaseModel):
    type: str
    category: str
    description: str
    amount: float
    date: str

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero")
        if v > 999_999_999:
            raise ValueError("Valor excede o limite permitido")
        return round(v, 2)

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Descri\u00e7\u00e3o \u00e9 obrigat\u00f3ria")
        if len(v) > 500:
            raise ValueError("Descri\u00e7\u00e3o muito longa (m\u00e1x 500 caracteres)")
        return v.strip()

    @field_validator("category")
    @classmethod
    def category_valid(cls, v):
        if not v or len(v) > 100:
            raise ValueError("Categoria inv\u00e1lida")
        return v.strip()

    @field_validator("date")
    @classmethod
    def date_valid(cls, v):
        return _validate_date(v)


class UpdateTransaction(BaseModel):
    description: str | None = None
    amount: float | None = None
    date: str | None = None
    category: str | None = None
    type: str | None = None

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v is not None:
            if v <= 0:
                raise ValueError("O valor deve ser maior que zero")
            if v > 999_999_999:
                raise ValueError("Valor excede o limite permitido")
            return round(v, 2)
        return v

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v):
        if v is not None:
            if not v or not v.strip():
                raise ValueError("Descri\u00e7\u00e3o \u00e9 obrigat\u00f3ria")
            if len(v) > 500:
                raise ValueError("Descri\u00e7\u00e3o muito longa (m\u00e1x 500 caracteres)")
            return v.strip()
        return v

    @field_validator("date")
    @classmethod
    def date_valid(cls, v):
        if v is not None:
            return _validate_date(v)
        return v


class BudgetItem(BaseModel):
    category: str
    amount: float

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero")
        return round(v, 2)


class RecurringItem(BaseModel):
    id: str
    type: str
    category: str
    description: str
    amount: float
    day: int

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero")
        return round(v, 2)

    @field_validator("day")
    @classmethod
    def day_valid(cls, v):
        if v < 1 or v > 28:
            raise ValueError("Dia deve ser entre 1 e 28")
        return v


# ---------- Routes ----------

@app.get("/")
def index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "index.html"))


@app.get("/api/categories")
def get_categories():
    return {"data": {t: {"color": v["color"], "icons": v["icons"]} for t, v in VALID_CATEGORIES.items()}}


@app.get("/api/transactions")
def get_transactions():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()
        return {"data": [dict(r) for r in rows]}


@app.post("/api/transactions")
def create_transaction(t: Transaction):
    if t.type not in VALID_TYPES:
        raise HTTPException(400, f"Tipo deve ser: {', '.join(VALID_TYPES)}")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO transactions (type, category, description, amount, date) VALUES (?, ?, ?, ?, ?)",
            (t.type, t.category, t.description, t.amount, t.date),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {"data": dict(row)}


@app.put("/api/transactions/{tid}")
def update_transaction(tid: int, t: UpdateTransaction):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
        if not existing:
            raise HTTPException(404, "N\u00e3o encontrada")

        updates = {}
        if t.description is not None:
            updates["description"] = t.description
        if t.amount is not None:
            updates["amount"] = t.amount
        if t.date is not None:
            updates["date"] = t.date
        if t.category is not None:
            updates["category"] = t.category
        if t.type is not None:
            if t.type not in VALID_TYPES:
                raise HTTPException(400, "Tipo inv\u00e1lido")
            updates["type"] = t.type

        if updates:
            # Validate column names against whitelist — no injection possible
            invalid = set(updates.keys()) - ALLOWED_COLUMNS
            if invalid:
                raise HTTPException(400, f"Campos inv\u00e1lidos: {', '.join(invalid)}")
            sets = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE transactions SET {sets} WHERE id = ?",
                (*updates.values(), tid),
            )
            conn.commit()

        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
        return {"data": dict(row)}


@app.delete("/api/transactions/{tid}")
def delete_transaction(tid: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM transactions WHERE id = ?", (tid,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "N\u00e3o encontrada")
        return {"data": "ok"}


# ---------- Budgets ----------

@app.get("/api/budgets")
def get_budgets():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM budgets").fetchall()
        return {"data": {r["category"]: r["amount"] for r in rows}}


@app.post("/api/budgets")
def save_budget(b: BudgetItem):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO budgets (category, amount) VALUES (?, ?)",
            (b.category, b.amount),
        )
        conn.commit()
        return {"data": {"category": b.category, "amount": b.amount}}


@app.delete("/api/budgets/{category}")
def delete_budget(category: str):
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE category = ?", (category,))
        conn.commit()
        return {"data": "ok"}


# ---------- Recurring ----------

@app.get("/api/recurring")
def get_recurring():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM recurring").fetchall()
        return {"data": [dict(r) for r in rows]}


@app.post("/api/recurring")
def save_recurring(r: RecurringItem):
    if r.type not in VALID_TYPES:
        raise HTTPException(400, "Tipo inv\u00e1lido")
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO recurring (id, type, category, description, amount, day) VALUES (?, ?, ?, ?, ?, ?)",
            (r.id, r.type, r.category, r.description, r.amount, r.day),
        )
        conn.commit()
        return {"data": dict(r)}


@app.delete("/api/recurring/{rid}")
def delete_recurring(rid: str):
    with get_db() as conn:
        conn.execute("DELETE FROM recurring WHERE id = ?", (rid,))
        conn.commit()
        return {"data": "ok"}


# ---------- Summary ----------

@app.get("/api/summary")
def summary():
    with get_db() as conn:
        total_income = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'receita'"
        ).fetchone()[0]
        total_expense = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'expense'"
        ).fetchone()[0]
        by_category = conn.execute(
            "SELECT type, category, SUM(amount) as total FROM transactions GROUP BY type, category ORDER BY total DESC"
        ).fetchall()
        by_month_raw = conn.execute(
            "SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total FROM transactions GROUP BY month, type ORDER BY month DESC"
        ).fetchall()

        return {
            "data": {
                "total_income": total_income,
                "total_expense": total_expense,
                "balance": total_income - total_expense,
                "by_category": [dict(r) for r in by_category],
                "by_month": [dict(r) for r in by_month_raw],
            }
        }


# ---------- Export/Import ----------

@app.get("/api/export-csv")
def export_csv():
    with get_db() as conn:
        rows = conn.execute("SELECT type, category, description, amount, date FROM transactions ORDER BY date DESC").fetchall()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["tipo", "categoria", "descricao", "valor", "data"])
    for r in rows:
        writer.writerow([r["type"], r["category"], r["description"], r["amount"], r["date"]])
    return Response(content=output.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=finance_export.csv"
    })


@app.post("/api/import-csv")
async def import_csv(request: Request):
    body = await request.body()
    text = body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    imported = 0
    with get_db() as conn:
        for row in reader:
            t = row.get("tipo", "").strip()
            category = row.get("categoria", "").strip()
            description = row.get("descricao", "").strip()
            amount = row.get("valor", "").strip()
            date = row.get("data", "").strip()
            if not all([t, category, description, amount, date]):
                continue
            if t not in VALID_TYPES:
                continue
            try:
                amount_f = float(amount.replace(",", "."))
            except ValueError:
                continue
            if amount_f <= 0:
                continue
            try:
                _validate_date(date)
            except HTTPException:
                continue
            conn.execute(
                "INSERT INTO transactions (type, category, description, amount, date) VALUES (?, ?, ?, ?, ?)",
                (t, category, description, amount_f, date),
            )
            imported += 1
        conn.commit()
    return {"data": {"imported": imported}}
