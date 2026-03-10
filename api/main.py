# =============================================================================
# ScamShield — FastAPI Server
# =============================================================================
# MOCK_MODE = True  → returns simulated predictions (use while model is training)
# MOCK_MODE = False → loads real trained model from scam_model/
#
# Run:
#   cd C:\scam_project\api
#   uvicorn main:app --reload --host 0.0.0.0 --port 8000
# =============================================================================

import os
import sqlite3
import datetime
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# ── CONFIG ────────────────────────────────────────────────────────────────────
MOCK_MODE  = False   # ← Set to True while model is training on Colab
MODEL_DIR  = os.path.join(os.path.dirname(__file__), "..", "scam_model")
DB_PATH    = os.path.join(os.path.dirname(__file__), "detections.db")
DEVICE     = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MAX_LEN    = 128

# Only 2 metadata features as per spec
METADATA_COLS = ["account_age", "posting_frequency"]


# ── MODEL ARCHITECTURE (must match scam_detection.py) ────────────────────────
class EarlyFusionScamDetector(nn.Module):
    """
    Multi-modal Early Fusion model.
    768-dim mBERT [CLS] + 2 metadata values = 770-dim → single FC layer → 2 classes
    """
    def __init__(self, bert_model_name):
        super().__init__()
        from transformers import AutoModel
        self.bert       = AutoModel.from_pretrained(bert_model_name)
        self.classifier = nn.Linear(768 + 2, 2)

    def forward(self, input_ids, attention_mask, metadata):
        bert_out      = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_embedding = bert_out.last_hidden_state[:, 0, :]       # [batch, 768]
        fused         = torch.cat([cls_embedding, metadata], dim=1) # [batch, 770]
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


# ── DATABASE ──────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
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
            is_mock           INTEGER DEFAULT 0
        )
    """)
    # Migration: safely add columns missing from older databases
    existing = {row[1] for row in conn.execute("PRAGMA table_info(detections)").fetchall()}
    if "account_age" not in existing:
        conn.execute("ALTER TABLE detections ADD COLUMN account_age INTEGER DEFAULT 0")
    if "posting_frequency" not in existing:
        conn.execute("ALTER TABLE detections ADD COLUMN posting_frequency REAL DEFAULT 0")
    conn.commit()
    conn.close()

init_db()

def save_detection(data: dict, is_mock: bool = False):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO detections
        (timestamp, platform, text, label, verdict, confidence,
         scam_prob, legit_prob, account_age, posting_frequency, is_mock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        datetime.datetime.utcnow().isoformat(),
        data.get("platform", "unknown"),
        (data.get("text", ""))[:500],
        data.get("label",     -1),
        data.get("verdict",   ""),
        data.get("confidence", 0),
        data.get("scam_prob",  0),
        data.get("legit_prob", 0),
        data.get("account_age",       0),
        data.get("posting_frequency", 0),
        1 if is_mock else 0,
    ))
    conn.commit()
    conn.close()


# ── FASTAPI APP ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="ScamShield API",
    description="Taglish scam detection — mBERT + Early Fusion (770-dim)",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── REQUEST SCHEMA ────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    text:               str
    platform:           Optional[str]   = "facebook"
    account_age:        Optional[float] = 365.0   # days
    posting_frequency:  Optional[float] = 1.0     # posts per day


# ── MOCK PREDICTION ───────────────────────────────────────────────────────────
def mock_predict(req: PredictRequest) -> dict:
    """Simulates prediction using keyword + metadata rules while model is training."""
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
    """Runs the real mBERT + Early Fusion model."""
    # Tokenize text
    enc = tokenizer(
        req.text, max_length=MAX_LEN, padding='max_length',
        truncation=True, return_tensors='pt'
    )
    input_ids      = enc['input_ids'].to(DEVICE)
    attention_mask = enc['attention_mask'].to(DEVICE)

    # Normalize metadata with fitted MinMaxScaler
    meta_raw    = np.array([[req.account_age, req.posting_frequency]], dtype=np.float32)
    meta_scaled = scaler.transform(meta_raw)
    metadata    = torch.tensor(meta_scaled, dtype=torch.float32).to(DEVICE)

    # Run model
    with torch.no_grad():
        logits = model(input_ids, attention_mask, metadata)
        probs  = torch.softmax(logits, dim=1)[0]
        label  = logits.argmax(dim=1).item()

    # Risk score = softmax probability of Scam class × 100
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

@app.post("/predict")
def predict(req: PredictRequest):
    result = mock_predict(req) if MOCK_MODE else real_predict(req)
    save_detection({**req.dict(), **result}, is_mock=MOCK_MODE)
    return result

@app.get("/detections")
def get_detections(limit: int = 100, platform: Optional[str] = None):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    query  = (
        "SELECT * FROM detections WHERE platform=? ORDER BY id DESC LIMIT ?"
        if platform else
        "SELECT * FROM detections ORDER BY id DESC LIMIT ?"
    )
    params = (platform, limit) if platform else (limit,)
    rows   = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/stats")
def get_stats():
    conn     = sqlite3.connect(DB_PATH)
    total    = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
    scam     = conn.execute("SELECT COUNT(*) FROM detections WHERE label=1").fetchone()[0]
    legit    = conn.execute("SELECT COUNT(*) FROM detections WHERE label=0").fetchone()[0]
    fb       = conn.execute("SELECT COUNT(*) FROM detections WHERE platform='facebook'").fetchone()[0]
    tw       = conn.execute("SELECT COUNT(*) FROM detections WHERE platform='twitter'").fetchone()[0]
    today    = datetime.date.today().isoformat()
    today_ct = conn.execute(
        "SELECT COUNT(*) FROM detections WHERE timestamp LIKE ?", (f"{today}%",)
    ).fetchone()[0]
    conn.close()
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
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM detections")
    conn.commit()
    conn.close()
    return {"message": "All detections cleared."}