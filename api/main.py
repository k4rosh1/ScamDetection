# =============================================================================
# ScamShield — FastAPI Server  (v3 — Optimized + Encrypted)
# =============================================================================
# MOCK_MODE = True  → simulated predictions (while model is training on Colab)
# MOCK_MODE = False → loads real trained model from scam_model/
#
# Run:
#   cd C:\scam_project\api
#   uvicorn main:app --reload --host 0.0.0.0 --port 8000
#
# First-time setup — generate encryption key:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   Copy the output into a file called  api/.env  as:
#   DB_ENCRYPTION_KEY=<paste key here>
# =============================================================================

import os
import hashlib
import sqlite3
import datetime
import threading
import numpy as np
import torch
import torch.nn as nn
from contextlib import contextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import Optional
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from cryptography.fernet import Fernet

# ── CONFIG ────────────────────────────────────────────────────────────────────
MOCK_MODE  = False
MODEL_DIR  = os.path.join(os.path.dirname(__file__), "..", "scam_model")
DB_PATH    = os.path.join(os.path.dirname(__file__), "detections.db")
DEVICE     = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MAX_LEN    = 128
METADATA_COLS = ["account_age", "posting_frequency"]

# ── ENCRYPTION SETUP ──────────────────────────────────────────────────────────
# Load key from .env file or environment variable
def _load_key() -> bytes:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("DB_ENCRYPTION_KEY="):
                    return line.split("=", 1)[1].strip().encode()
    # Fall back to environment variable
    key = os.environ.get("DB_ENCRYPTION_KEY")
    if key:
        return key.encode()
    # Auto-generate and save if no key exists (first run)
    new_key = Fernet.generate_key()
    with open(env_path, "w") as f:
        f.write(f"DB_ENCRYPTION_KEY={new_key.decode()}\n")
    print("🔑 Encryption key auto-generated and saved to api/.env")
    print("   Keep this file safe — losing it means losing access to stored data.")
    return new_key

_fernet = Fernet(_load_key())

def encrypt(value: str) -> str:
    """Encrypt a string value before storing in the database."""
    if not value:
        return ""
    return _fernet.encrypt(value.encode()).decode()

def decrypt(value: str) -> str:
    """Decrypt a string value after reading from the database."""
    if not value:
        return ""
    try:
        return _fernet.decrypt(value.encode()).decode()
    except Exception:
        # Already plain text (migration: old unencrypted rows)
        return value

# ── DATABASE ──────────────────────────────────────────────────────────────────
# Connection pool using thread-local storage — one connection per thread,
# reused across requests instead of opening/closing on every call.
_local = threading.local()

@contextmanager
def get_db():
    """Thread-local SQLite connection with WAL mode and foreign keys enabled."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        # WAL mode: readers don't block writers, better concurrent performance
        _local.conn.execute("PRAGMA journal_mode=WAL")
        # Improve write performance
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.execute("PRAGMA cache_size=1000")
    try:
        yield _local.conn
    except Exception:
        _local.conn.rollback()
        raise

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS detections (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp         TEXT,
                platform          TEXT,
                text              TEXT,
                label             INTEGER,
                verdict           TEXT,
                confidence        REAL,
                scam_prob         REAL,
                legit_prob        REAL,
                account_age       INTEGER,
                posting_frequency REAL,
                is_mock           INTEGER DEFAULT 0,
                text_hash         TEXT,
                duplicate_count   INTEGER DEFAULT 0
            )
        """)
        # Create index for faster stats queries
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_label
            ON detections(label)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_platform
            ON detections(platform)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_timestamp
            ON detections(timestamp)
        """)
        # Index for fast duplicate lookup on text_hash
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_text_hash
            ON detections(text_hash)
        """)
        # Migration: add missing columns from older databases
        existing = {row[1] for row in conn.execute("PRAGMA table_info(detections)").fetchall()}
        if "account_age" not in existing:
            conn.execute("ALTER TABLE detections ADD COLUMN account_age INTEGER DEFAULT 0")
        if "posting_frequency" not in existing:
            conn.execute("ALTER TABLE detections ADD COLUMN posting_frequency REAL DEFAULT 0")
        if "text_hash" not in existing:
            conn.execute("ALTER TABLE detections ADD COLUMN text_hash TEXT")
        if "duplicate_count" not in existing:
            conn.execute("ALTER TABLE detections ADD COLUMN duplicate_count INTEGER DEFAULT 0")
        conn.commit()
    print("✅ Database initialized with WAL mode and indexes")

init_db()

def _make_hash(text: str, platform: str, account_age: float, posting_frequency: float) -> str:
    """Create a SHA-256 hash of the input combination for duplicate detection."""
    raw = f"{text.strip().lower()}|{platform}|{round(account_age)}|{round(posting_frequency, 1)}"
    return hashlib.sha256(raw.encode()).hexdigest()

def find_duplicate(text: str, platform: str, account_age: float, posting_frequency: float):
    """Check if this exact input combination was already detected before.
    Returns the existing row dict if found, None otherwise."""
    h = _make_hash(text, platform, account_age, posting_frequency)
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM detections WHERE text_hash=? ORDER BY id DESC LIMIT 1", (h,)
        ).fetchone()
        if row:
            # Increment duplicate_count so we track how many times it was re-scanned
            conn.execute(
                "UPDATE detections SET duplicate_count = duplicate_count + 1 WHERE id=?",
                (row["id"],)
            )
            conn.commit()
            result = decrypt_row(dict(row))
            result["is_duplicate"] = True
            return result
    return None

def save_detection(data: dict, is_mock: bool = False):
    """Save detection with encrypted text, platform, and verdict fields."""
    with get_db() as conn:
        conn.execute("""
            INSERT INTO detections
            (timestamp, platform, text, label, verdict, confidence,
             scam_prob, legit_prob, account_age, posting_frequency, is_mock, text_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.datetime.utcnow().isoformat(),
            encrypt(data.get("platform", "unknown")),   # encrypted
            encrypt((data.get("text", ""))[:500]),       # encrypted
            data.get("label",     -1),
            encrypt(data.get("verdict", "")),            # encrypted
            data.get("confidence", 0),
            data.get("scam_prob",  0),
            data.get("legit_prob", 0),
            data.get("account_age",       0),
            data.get("posting_frequency", 0),
            1 if is_mock else 0,
            _make_hash(
                data.get("text", ""),
                data.get("platform", "unknown"),
                data.get("account_age", 0),
                data.get("posting_frequency", 0),
            ),
        ))
        conn.commit()

def decrypt_row(row: dict) -> dict:
    """Decrypt encrypted fields in a row dict before returning to frontend."""
    row["text"]     = decrypt(row.get("text",     ""))
    row["platform"] = decrypt(row.get("platform", ""))
    row["verdict"]  = decrypt(row.get("verdict",  ""))
    return row

# ── MODEL ARCHITECTURE ────────────────────────────────────────────────────────
class EarlyFusionScamDetector(nn.Module):
    """
    Multi-modal Early Fusion model.
    768-dim mBERT [CLS] + 2 metadata = 770-dim → single FC layer → 2 classes
    """
    def __init__(self, bert_model_name):
        super().__init__()
        from transformers import AutoModel
        self.bert       = AutoModel.from_pretrained(bert_model_name)
        self.classifier = nn.Linear(768 + 2, 2)

    def forward(self, input_ids, attention_mask, metadata):
        bert_out      = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_embedding = bert_out.last_hidden_state[:, 0, :]
        fused         = torch.cat([cls_embedding, metadata], dim=1)
        return self.classifier(fused)

# ── LOAD REAL MODEL ───────────────────────────────────────────────────────────
tokenizer = None
scaler    = None
model     = None

if not MOCK_MODE:
    try:
        import joblib
        from transformers import AutoTokenizer
        print(f"Loading model from {MODEL_DIR}...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
        scaler    = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
        model     = EarlyFusionScamDetector(bert_model_name="bert-base-multilingual-cased")
        model.load_state_dict(
            torch.load(os.path.join(MODEL_DIR, "model.pt"), map_location=DEVICE),
            strict=False
        )
        model.to(DEVICE)
        model.eval()
        print(f"✅ Real model loaded on {DEVICE}")
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        print("   Falling back to MOCK_MODE")
        MOCK_MODE = True
else:
    print("🟡 MOCK_MODE is ON — returning simulated predictions")

# ── RATE LIMITER ──────────────────────────────────────────────────────────────
# Limits: /predict → 30 requests/minute per IP (prevents spam/abuse)
#         /stats   → 60 requests/minute per IP
#         /detections → 60 requests/minute per IP
limiter = Limiter(key_func=get_remote_address)

# ── FASTAPI APP ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="ScamShield API",
    description="Taglish scam detection — mBERT + Early Fusion (770-dim)",
    version="3.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Load allowed origins from .env
# Local dev:   ALLOWED_ORIGINS=http://localhost:3000
# Production:  ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
def _load_allowed_origins() -> list:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ALLOWED_ORIGINS="):
                    raw = line.split("=", 1)[1].strip()
                    return [o.strip() for o in raw.split(",") if o.strip()]
    env_val = os.environ.get("ALLOWED_ORIGINS", "")
    if env_val:
        return [o.strip() for o in env_val.split(",") if o.strip()]
    # Fallback to localhost only
    return ["http://localhost:3000"]

ALLOWED_ORIGINS = _load_allowed_origins()
print(f"🌐 CORS allowed origins: {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

# ── REQUEST SCHEMA ────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    text:              str
    platform:          Optional[str]   = "facebook"
    account_age:       Optional[float] = 365.0
    posting_frequency: Optional[float] = 1.0

    @validator("text")
    def text_must_not_be_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("text cannot be empty")
        if len(v) > 2000:
            raise ValueError("text exceeds maximum length of 2000 characters")
        return v.strip()

    @validator("account_age")
    def age_must_be_positive(cls, v):
        if v is None: return 365.0
        return max(0.0, float(v))

    @validator("posting_frequency")
    def freq_must_be_positive(cls, v):
        if v is None: return 1.0
        return max(0.0, float(v))

# ── MOCK PREDICTION ───────────────────────────────────────────────────────────
def mock_predict(req: PredictRequest) -> dict:
    text  = req.text.lower()
    score = 0
    scam_keywords = [
        "kumita", "pesos", "₱", "gcash", "dm mo", "libre", "free",
        "promo", "raffle", "invest", "click", "bit.ly", "tinyurl",
        "congratulations", "nanalo", "limited", "urgent", "verify"
    ]
    for kw in scam_keywords:
        if kw in text:
            score += 15
    if req.account_age       < 90:  score += 20
    if req.posting_frequency > 10:  score += 25
    score      = max(0, min(100, score))
    label      = 1 if score >= 50 else 0
    scam_prob  = float(score)
    legit_prob = 100.0 - scam_prob
    confidence = scam_prob if label == 1 else legit_prob
    return {
        "label":      label,
        "verdict":    "SCAM" if label == 1 else "LEGITIMATE",
        "confidence": f"{confidence:.1f}%",
        "scam_prob":  f"{scam_prob:.1f}%",
        "legit_prob": f"{legit_prob:.1f}%",
        "platform":   req.platform,
        "is_mock":    True,
    }

# ── REAL PREDICTION ───────────────────────────────────────────────────────────
def real_predict(req: PredictRequest) -> dict:
    enc = tokenizer(
        req.text, max_length=MAX_LEN, padding='max_length',
        truncation=True, return_tensors='pt'
    )
    input_ids      = enc['input_ids'].to(DEVICE)
    attention_mask = enc['attention_mask'].to(DEVICE)
    meta_raw    = np.array([[req.account_age, req.posting_frequency]], dtype=np.float32)
    meta_scaled = scaler.transform(meta_raw)
    metadata    = torch.tensor(meta_scaled, dtype=torch.float32).to(DEVICE)
    with torch.no_grad():
        logits = model(input_ids, attention_mask, metadata)
        probs  = torch.softmax(logits, dim=1)[0]
        label  = logits.argmax(dim=1).item()
    confidence = probs[label].item() * 100
    scam_prob  = probs[1].item() * 100
    legit_prob = probs[0].item() * 100
    return {
        "label":      label,
        "verdict":    "SCAM" if label == 1 else "LEGITIMATE",
        "confidence": f"{confidence:.1f}%",
        "scam_prob":  f"{scam_prob:.1f}%",
        "legit_prob": f"{legit_prob:.1f}%",
        "platform":   req.platform,
        "is_mock":    False,
    }

# ── ENDPOINTS ─────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status":    "running",
        "mock_mode": MOCK_MODE,
        "device":    str(DEVICE),
        "docs":      "http://localhost:8000/docs"
    }

@app.get("/health")
def health():
    """Dedicated health check endpoint — used by browser extension and frontend."""
    return {
        "status":    "ok",
        "mock_mode": MOCK_MODE,
        "device":    str(DEVICE),
    }

@app.post("/predict")
@limiter.limit("30/minute")
def predict(req: PredictRequest, request: Request):
    # Check for duplicate before running the model
    existing = find_duplicate(
        req.text, req.platform, req.account_age, req.posting_frequency
    )
    if existing:
        # Return cached result — model not invoked, database not re-written
        return {
            "label":           existing.get("label", -1),
            "verdict":         existing.get("verdict", ""),
            "confidence":      existing.get("confidence", ""),
            "scam_prob":       existing.get("scam_prob", ""),
            "legit_prob":      existing.get("legit_prob", ""),
            "platform":        existing.get("platform", req.platform),
            "is_mock":         bool(existing.get("is_mock", 0)),
            "is_duplicate":    True,
            "duplicate_count": existing.get("duplicate_count", 1),
        }

    # New input — run model and save
    result = mock_predict(req) if MOCK_MODE else real_predict(req)
    result["is_duplicate"] = False
    save_detection({**req.dict(), **result}, is_mock=MOCK_MODE)
    return result

@app.get("/detections")
@limiter.limit("60/minute")
def get_detections(request: Request, limit: int = 100, platform: Optional[str] = None):
    with get_db() as conn:
        if platform:
            # Platform is encrypted — fetch all and filter after decryption
            rows = conn.execute(
                "SELECT * FROM detections ORDER BY id DESC LIMIT 500"
            ).fetchall()
            result = [decrypt_row(dict(r)) for r in rows]
            result = [r for r in result if r["platform"] == platform][:limit]
        else:
            rows = conn.execute(
                "SELECT * FROM detections ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            result = [decrypt_row(dict(r)) for r in rows]
    return result

@app.get("/stats")
@limiter.limit("60/minute")
def get_stats(request: Request):
    today = datetime.date.today().isoformat()
    with get_db() as conn:
        # Single optimized query for all counts
        row = conn.execute("""
            SELECT
                COUNT(*)                                      AS total,
                SUM(CASE WHEN label=1 THEN 1 ELSE 0 END)     AS scam,
                SUM(CASE WHEN label=0 THEN 1 ELSE 0 END)     AS legit,
                SUM(CASE WHEN timestamp LIKE ? THEN 1 ELSE 0 END) AS today_ct
            FROM detections
        """, (f"{today}%",)).fetchone()
        total    = row["total"]    or 0
        scam     = row["scam"]     or 0
        legit    = row["legit"]    or 0
        today_ct = row["today_ct"] or 0

        # Platform counts — decrypt platform field and count
        all_rows = conn.execute(
            "SELECT platform FROM detections"
        ).fetchall()

    fb = sum(1 for r in all_rows if decrypt(r["platform"]) == "facebook")
    tw = sum(1 for r in all_rows if decrypt(r["platform"]) == "twitter")

    return {
        "total_detections": total,
        "scam_count":       scam,
        "legit_count":      legit,
        "scam_rate":        f"{(scam/total*100):.1f}%" if total > 0 else "0%",
        "facebook_total":   fb,
        "twitter_total":    tw,
        "detections_today": today_ct,
        "mock_mode":        MOCK_MODE,
    }

@app.delete("/detections/clear")
def clear_detections():
    with get_db() as conn:
        conn.execute("DELETE FROM detections")
        conn.commit()
    return {"message": "All detections cleared."}