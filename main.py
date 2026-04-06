from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import sqlite3
import os
from datetime import datetime

app = FastAPI()

DB = os.path.join(os.path.dirname(__file__), "finance.db")

CATEGORIES = {
    "receita": {"color": "#22c55e", "icons": {"Salary": "💰", "Investments": "📈", "Freelance": "💻", "Other": "✨"}},
    "expense": {"color": "#ef4444", "icons": {"Food": "🍔", "Transport": "🚗", "Housing": "🏠", "Health": "💊", "Entertainment": "🎬", "Shopping": "🛍", "Education": "📚", "Other": "✨"}},
}

CATEGORIES = {r: CATEGORIES[r] for r in ("receita", "expense")}


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT CHECK(type IN ('receita', 'expense')),
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.commit()
    conn.close()


init_db()


class Transaction(BaseModel):
    type: str
    category: str
    description: str
    amount: float
    date: str


class UpdateTransaction(BaseModel):
    description: str | None = None
    amount: float | None = None
    date: str | None = None
    category: str | None = None


# ---------- Routes ----------

@app.get("/")
def index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "index.html"))


@app.get("/api/categories")
def get_categories():
    return {"data": {t: {"color": v["color"], "icons": v["icons"]} for t, v in CATEGORIES.items()}}


@app.get("/api/transactions")
def get_transactions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()
    conn.close()
    return {"data": [dict(r) for r in rows]}


@app.post("/api/transactions")
def create_transaction(t: Transaction):
    if t.type not in CATEGORIES:
        raise HTTPException(400, f"Tipo deve ser: {', '.join(CATEGORIES.keys())}")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO transactions (type, category, description, amount, date) VALUES (?, ?, ?, ?, ?)",
        (t.type, t.category, t.description, t.amount, t.date),
    )
    conn.commit()
    tid = cur.lastrowid
    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
    conn.close()
    return {"data": dict(row)}


@app.put("/api/transactions/{tid}")
def update_transaction(tid: int, t: UpdateTransaction):
    conn = get_db()
    existing = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Não encontrada")

    updates = {}
    if t.description is not None:
        updates["description"] = t.description
    if t.amount is not None:
        updates["amount"] = t.amount
    if t.date is not None:
        updates["date"] = t.date
    if t.category is not None:
        updates["category"] = t.category

    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE transactions SET {sets} WHERE id = ?",
            (*updates.values(), tid),
        )
        conn.commit()

    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
    conn.close()
    return {"data": dict(row)}


@app.delete("/api/transactions/{tid}")
def delete_transaction(tid: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM transactions WHERE id = ?", (tid,))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    if not ok:
        raise HTTPException(404, "Não encontrada")
    return {"data": "ok"}


@app.get("/api/summary")
def summary():
    conn = get_db()
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
    conn.close()

    return {
        "data": {
            "total_income": total_income,
            "total_expense": total_expense,
            "balance": total_income - total_expense,
            "by_category": [dict(r) for r in by_category],
            "by_month": [dict(r) for r in by_month_raw],
        }
    }
