# =============================================================================
# Multi-Modal Scam Detection System
# mBERT (Multilingual BERT) + Metadata — Early Fusion Architecture
# =============================================================================
#
# PIPELINE:
#   Step 1 - Text Processing   : mBERT tokenization → [CLS] token → 768-dim vector
#   Step 2 - Metadata Norm     : MinMaxScaler on account_age + posting_frequency
#   Step 3 - Early Fusion      : Concatenate 768 + 2 = 770-dim unified vector
#   Step 4 - Classification    : Single FC layer + Softmax → Scam / Legitimate
#   Step 5 - Training          : AdamW, lr=2e-5, CrossEntropyLoss, 5 epochs
#   Step 6 - Evaluation        : Model A (text-only) vs Model B (multi-modal)
#   Step 7 - Risk Score        : softmax probability of Scam class × 100
#
# USAGE:
#   Step 1: python generate_fake_dataset.py
#   Step 2: python scam_detection.py
# =============================================================================


# ── IMPORTS ───────────────────────────────────────────────────────────────────
import os
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModel
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import (accuracy_score, precision_score,
                             recall_score, f1_score, classification_report)
import matplotlib.pyplot as plt
import seaborn as sns
from tqdm import tqdm
import joblib
import warnings
warnings.filterwarnings("ignore")


# ── CONFIG ────────────────────────────────────────────────────────────────────
MODEL_NAME    = "bert-base-multilingual-cased"  # mBERT — supports Tagalog + English
DEVICE        = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MAX_LEN       = 128       # maximum token sequence length
BATCH_SIZE    = 16
EPOCHS        = 5         # fixed 5 epochs as per spec
LR            = 2e-5      # AdamW learning rate
METADATA_COLS = ["account_age", "posting_frequency"]   # only 2 metadata features

print(f"Using device: {DEVICE}")


# ── STEP 1: LOAD DATASET ──────────────────────────────────────────────────────
print("\n[1/8] Loading dataset...")
df = pd.read_csv("scam_dataset.csv")
print(f"   Total samples: {len(df)}  |  Scam: {df['label'].sum()}  |  Legit: {(df['label']==0).sum()}")

# Separate text, metadata, and labels
X_text = df["text"].values
X_meta = df[METADATA_COLS].values.astype(np.float32)
y      = df["label"].values


# ── STEP 2: SPLIT DATASET (80% train / 10% val / 10% test) ───────────────────
print("\n[2/8] Splitting data (80% train / 10% val / 10% test)...")

# First split: 80% train, 20% temp
X_text_train, X_text_temp, X_meta_train, X_meta_temp, y_train, y_temp = train_test_split(
    X_text, X_meta, y, test_size=0.20, random_state=42, stratify=y
)

# Second split: 50/50 of the 20% temp → 10% val, 10% test
X_text_val, X_text_test, X_meta_val, X_meta_test, y_val, y_test = train_test_split(
    X_text_temp, X_meta_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp
)

print(f"   Train: {len(y_train)}  |  Val: {len(y_val)}  |  Test: {len(y_test)}")


# ── STEP 3: NORMALIZE METADATA (MinMaxScaler) ─────────────────────────────────
print("\n[3/8] Normalizing metadata with MinMaxScaler...")

# Fit ONLY on training data to prevent data leakage
scaler         = MinMaxScaler()
X_meta_train   = scaler.fit_transform(X_meta_train)   # fit + transform on train
X_meta_val     = scaler.transform(X_meta_val)          # transform only on val
X_meta_test    = scaler.transform(X_meta_test)         # transform only on test

# Save scaler for inference and API use
os.makedirs("./scam_model", exist_ok=True)
joblib.dump(scaler, "./scam_model/scaler.pkl")
print("   ✅ MinMaxScaler fitted and saved to ./scam_model/scaler.pkl")


# ── STEP 4: LOAD mBERT TOKENIZER ─────────────────────────────────────────────
print(f"\n[4/8] Loading mBERT tokenizer: {MODEL_NAME}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
tokenizer.save_pretrained("./scam_model")
print("   ✅ Tokenizer saved to ./scam_model/")


# ── DATASET CLASS ─────────────────────────────────────────────────────────────
class ScamDataset(Dataset):
    """
    PyTorch Dataset that tokenizes text and returns metadata + label.
    """
    def __init__(self, texts, metadata, labels, tokenizer, max_len):
        self.texts     = texts
        self.metadata  = metadata
        self.labels    = labels
        self.tokenizer = tokenizer
        self.max_len   = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        # Tokenize the text using mBERT WordPiece tokenizer
        enc = self.tokenizer(
            str(self.texts[idx]),
            max_length=self.max_len,
            padding='max_length',
            truncation=True,
            return_tensors='pt'
        )
        return {
            'input_ids':      enc['input_ids'].squeeze(0),
            'attention_mask': enc['attention_mask'].squeeze(0),
            'metadata':       torch.tensor(self.metadata[idx], dtype=torch.float32),
            'label':          torch.tensor(self.labels[idx],   dtype=torch.long),
        }


# ── BUILD DATALOADERS ─────────────────────────────────────────────────────────
train_loader = DataLoader(ScamDataset(X_text_train, X_meta_train, y_train, tokenizer, MAX_LEN), batch_size=BATCH_SIZE, shuffle=True)
val_loader   = DataLoader(ScamDataset(X_text_val,   X_meta_val,   y_val,   tokenizer, MAX_LEN), batch_size=BATCH_SIZE)
test_loader  = DataLoader(ScamDataset(X_text_test,  X_meta_test,  y_test,  tokenizer, MAX_LEN), batch_size=BATCH_SIZE)


# ── STEP 5: MODEL ARCHITECTURE ───────────────────────────────────────────────
print("\n[5/8] Building models...")

# ── Model A: Text-Only Baseline (768-dim CLS only) ────────────────────────────
class TextOnlyBaseline(nn.Module):
    """
    Baseline model using only the mBERT [CLS] token (768-dim).
    Single fully connected layer + softmax for binary classification.
    """
    def __init__(self, bert_model_name):
        super().__init__()
        self.bert = AutoModel.from_pretrained(bert_model_name)

        # Single FC layer: 768 → 2 classes
        self.classifier = nn.Linear(768, 2)

    def forward(self, input_ids, attention_mask, metadata=None):
        # Extract [CLS] token from last hidden state → 768-dim vector
        bert_out      = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_embedding = bert_out.last_hidden_state[:, 0, :]   # [batch, 768]

        # Single FC layer → logits (softmax applied in loss function)
        return self.classifier(cls_embedding)


# ── Model B: Multi-Modal Early Fusion (770-dim) ───────────────────────────────
class EarlyFusionScamDetector(nn.Module):
    """
    Proposed multi-modal model.
    Concatenates 768-dim mBERT [CLS] vector with 2 normalized metadata values
    to produce a 770-dim unified feature vector.
    Single fully connected layer + softmax for binary classification.
    """
    def __init__(self, bert_model_name):
        super().__init__()
        self.bert = AutoModel.from_pretrained(bert_model_name)

        # Single FC layer: 770 (768 text + 2 metadata) → 2 classes
        self.classifier = nn.Linear(768 + 2, 2)

    def forward(self, input_ids, attention_mask, metadata):
        # Step 1: Extract [CLS] token → 768-dim semantic vector
        bert_out      = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_embedding = bert_out.last_hidden_state[:, 0, :]   # [batch, 768]

        # Step 2: Early Fusion — concatenate CLS vector with 2 metadata values
        fused = torch.cat([cls_embedding, metadata], dim=1)   # [batch, 770]

        # Step 3: Single FC layer → logits
        return self.classifier(fused)


# ── STEP 6: TRAINING FUNCTION ────────────────────────────────────────────────
def train_model(model, train_loader, val_loader, model_name="Model"):
    """
    Trains the model for a fixed number of epochs.
    Saves the best model checkpoint based on validation F1.
    """
    model.to(DEVICE)

    # AdamW optimizer with learning rate 2e-5
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)

    # CrossEntropyLoss as the loss function
    loss_fn   = nn.CrossEntropyLoss()

    history    = {"train_loss": [], "val_loss": [], "val_acc": [], "val_f1": []}
    best_f1    = 0.0
    best_state = None

    # Train for fixed 5 epochs
    for epoch in range(EPOCHS):

        # ── Training phase ────────────────────────────────────────────────────
        model.train()
        total_loss = 0
        for batch in tqdm(train_loader, desc=f"[{model_name}] Epoch {epoch+1}/{EPOCHS} Train"):
            input_ids      = batch['input_ids'].to(DEVICE)
            attention_mask = batch['attention_mask'].to(DEVICE)
            metadata       = batch['metadata'].to(DEVICE)
            labels         = batch['label'].to(DEVICE)

            optimizer.zero_grad()
            logits = model(input_ids, attention_mask, metadata)
            loss   = loss_fn(logits, labels)
            loss.backward()

            # Gradient clipping to prevent exploding gradients
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            total_loss += loss.item()

        avg_train_loss = total_loss / len(train_loader)

        # ── Validation phase ──────────────────────────────────────────────────
        model.eval()
        val_loss, all_preds, all_labels = 0, [], []
        with torch.no_grad():
            for batch in val_loader:
                input_ids      = batch['input_ids'].to(DEVICE)
                attention_mask = batch['attention_mask'].to(DEVICE)
                metadata       = batch['metadata'].to(DEVICE)
                labels         = batch['label'].to(DEVICE)

                logits    = model(input_ids, attention_mask, metadata)
                loss      = loss_fn(logits, labels)
                val_loss += loss.item()
                preds     = logits.argmax(dim=1).cpu().numpy()
                all_preds.extend(preds)
                all_labels.extend(labels.cpu().numpy())

        avg_val_loss = val_loss / len(val_loader)
        val_acc      = accuracy_score(all_labels, all_preds)
        val_f1       = f1_score(all_labels, all_preds)

        history["train_loss"].append(avg_train_loss)
        history["val_loss"].append(avg_val_loss)
        history["val_acc"].append(val_acc)
        history["val_f1"].append(val_f1)

        print(f"   Epoch {epoch+1}/{EPOCHS}: train_loss={avg_train_loss:.4f} | "
              f"val_loss={avg_val_loss:.4f} | val_acc={val_acc:.4f} | val_f1={val_f1:.4f}")

        # Save best checkpoint based on validation F1
        if val_f1 > best_f1:
            best_f1    = val_f1
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            os.makedirs("./checkpoints", exist_ok=True)
            torch.save({
                'epoch':            epoch + 1,
                'model_state_dict': best_state,
                'val_f1':           best_f1,
                'val_acc':          val_acc,
            }, f"./checkpoints/{model_name}_best.pt")
            print(f"   💾 Best checkpoint saved! Epoch {epoch+1} | F1={best_f1:.4f}")

    # Restore best model weights before returning
    if best_state:
        model.load_state_dict(best_state)

    return history


# ── STEP 7: EVALUATION FUNCTION ──────────────────────────────────────────────
def evaluate_model(model, test_loader, model_name="Model"):
    """
    Evaluates model on the held-out test set.
    Returns accuracy, precision, recall, and F1-score.
    """
    model.eval()
    all_preds, all_labels = [], []

    with torch.no_grad():
        for batch in test_loader:
            input_ids      = batch['input_ids'].to(DEVICE)
            attention_mask = batch['attention_mask'].to(DEVICE)
            metadata       = batch['metadata'].to(DEVICE)
            labels         = batch['label'].to(DEVICE)

            logits = model(input_ids, attention_mask, metadata)
            preds  = logits.argmax(dim=1).cpu().numpy()
            all_preds.extend(preds)
            all_labels.extend(labels.cpu().numpy())

    acc  = accuracy_score(all_labels,  all_preds)
    prec = precision_score(all_labels, all_preds)
    rec  = recall_score(all_labels,    all_preds)
    f1   = f1_score(all_labels,        all_preds)

    print(f"\n{'='*55}")
    print(f"  {model_name} — Test Set Evaluation")
    print(f"{'='*55}")
    print(f"  Accuracy  : {acc:.4f}")
    print(f"  Precision : {prec:.4f}")
    print(f"  Recall    : {rec:.4f}")
    print(f"  F1-Score  : {f1:.4f}")
    print(f"\n{classification_report(all_labels, all_preds, target_names=['Legitimate','Scam'])}")

    return {"accuracy": acc, "precision": prec, "recall": rec, "f1": f1,
            "preds": all_preds, "labels": all_labels}


# ── TRAIN MODEL A: TEXT-ONLY BASELINE ────────────────────────────────────────
print("\n[6/8] Training Model A — Text-Only Baseline (mBERT only)...")
baseline_model   = TextOnlyBaseline(bert_model_name=MODEL_NAME)
baseline_history = train_model(baseline_model, train_loader, val_loader, "Baseline")


# ── TRAIN MODEL B: MULTI-MODAL EARLY FUSION ───────────────────────────────────
print("\n[7/8] Training Model B — Multi-Modal Early Fusion (mBERT + Metadata)...")
multimodal_model   = EarlyFusionScamDetector(bert_model_name=MODEL_NAME)
multimodal_history = train_model(multimodal_model, train_loader, val_loader, "MultiModal")

# Save the multi-modal model and tokenizer
torch.save(multimodal_model.state_dict(), "./scam_model/model.pt")
print("\n✅ Model saved to ./scam_model/model.pt")


# ── STEP 8: EVALUATE BOTH MODELS ON TEST SET ─────────────────────────────────
print("\n[8/8] Evaluating both models on held-out test set...")

baseline_results   = evaluate_model(baseline_model,   test_loader, "Model A — Text-Only Baseline")
multimodal_results = evaluate_model(multimodal_model, test_loader, "Model B — Multi-Modal Early Fusion")

# ── Side-by-side comparison ───────────────────────────────────────────────────
print(f"\n{'='*55}")
print(f"  Model A vs Model B — Side-by-Side Comparison")
print(f"{'='*55}")
metrics = ["accuracy", "precision", "recall", "f1"]
for m in metrics:
    a   = baseline_results[m]
    b   = multimodal_results[m]
    diff = b - a
    sign = "++" if diff >= 0 else "--"
    print(f"  {m.capitalize():10}: A={a:.4f} | B={b:.4f} | {sign}{abs(diff):.4f}")

winner = "Model B (Multi-Modal)" if multimodal_results["f1"] >= baseline_results["f1"] else "Model A (Baseline)"
print(f"\n  Winner by F1: {winner}")


# ── GENERATE PLOTS ────────────────────────────────────────────────────────────
os.makedirs("./results", exist_ok=True)
epochs_x = list(range(1, EPOCHS + 1))

# Training curves
fig, axes = plt.subplots(1, 2, figsize=(12, 4))
fig.suptitle("Model B — Multi-Modal Training Curves", fontsize=13, fontweight='bold')

axes[0].plot(epochs_x, multimodal_history["train_loss"], label="Train Loss", marker='o')
axes[0].plot(epochs_x, multimodal_history["val_loss"],   label="Val Loss",   marker='s')
axes[0].set_title("Loss over Epochs")
axes[0].set_xlabel("Epoch"); axes[0].set_ylabel("Loss"); axes[0].legend()

axes[1].plot(epochs_x, multimodal_history["val_acc"], label="Val Accuracy", marker='o', color='green')
axes[1].plot(epochs_x, multimodal_history["val_f1"],  label="Val F1",       marker='s', color='orange')
axes[1].set_title("Accuracy & F1 over Epochs")
axes[1].set_xlabel("Epoch"); axes[1].legend()

plt.tight_layout()
plt.savefig("./results/training_curves.png", dpi=150)
plt.show()
print("✅ Training curves saved to ./results/training_curves.png")

# Confusion matrices
fig, axes = plt.subplots(1, 2, figsize=(10, 4))
fig.suptitle("Confusion Matrices — Model A vs Model B", fontsize=13, fontweight='bold')

from sklearn.metrics import confusion_matrix
for i, (res, title) in enumerate([
    (baseline_results,   "Model A — Text-Only"),
    (multimodal_results, "Model B — Multi-Modal"),
]):
    cm = confusion_matrix(res["labels"], res["preds"])
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', ax=axes[i],
                xticklabels=["Legit","Scam"], yticklabels=["Legit","Scam"])
    axes[i].set_title(title)
    axes[i].set_ylabel("True"); axes[i].set_xlabel("Predicted")

plt.tight_layout()
plt.savefig("./results/confusion_matrices.png", dpi=150)
plt.show()
print("✅ Confusion matrices saved to ./results/confusion_matrices.png")

# Model comparison bar chart
fig, ax = plt.subplots(figsize=(9, 5))
x      = np.arange(len(metrics))
width  = 0.35
bars_a = ax.bar(x - width/2, [baseline_results[m]   for m in metrics], width, label="Model A — Text-Only",   color='steelblue')
bars_b = ax.bar(x + width/2, [multimodal_results[m] for m in metrics], width, label="Model B — Multi-Modal", color='darkorange')
ax.set_xticks(x); ax.set_xticklabels([m.capitalize() for m in metrics])
ax.set_ylim(0, 1.1); ax.set_ylabel("Score"); ax.set_title("Model A vs Model B — Performance Comparison")
ax.legend()
for bar in list(bars_a) + list(bars_b):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
            f"{bar.get_height():.3f}", ha='center', va='bottom', fontsize=9)
plt.tight_layout()
plt.savefig("./results/model_comparison.png", dpi=150)
plt.show()
print("✅ Model comparison saved to ./results/model_comparison.png")


# ── INFERENCE FUNCTION ────────────────────────────────────────────────────────
def predict(text, account_age, posting_frequency, model=multimodal_model,
            tokenizer=tokenizer, scaler=scaler):
    """
    Inference function for single post prediction.

    Args:
        text              (str)   : The post caption (Taglish or English)
        account_age       (int)   : Account age in days
        posting_frequency (float) : Average posts per day

    Returns:
        label      (int)   : 1 = Scam, 0 = Legitimate
        verdict    (str)   : "SCAM" or "LEGITIMATE"
        risk_score (float) : Scam class softmax probability × 100
    """
    model.eval()

    # Step 1: Tokenize text
    enc = tokenizer(
        text, max_length=MAX_LEN, padding='max_length',
        truncation=True, return_tensors='pt'
    )
    input_ids      = enc['input_ids'].to(DEVICE)
    attention_mask = enc['attention_mask'].to(DEVICE)

    # Step 2: Normalize metadata using the fitted MinMaxScaler
    meta_raw    = np.array([[account_age, posting_frequency]], dtype=np.float32)
    meta_scaled = scaler.transform(meta_raw)
    metadata    = torch.tensor(meta_scaled, dtype=torch.float32).to(DEVICE)

    # Step 3: Run model and apply softmax
    with torch.no_grad():
        logits = model(input_ids, attention_mask, metadata)
        probs  = torch.softmax(logits, dim=1)[0]
        label  = logits.argmax(dim=1).item()

    # Step 7: Risk score = softmax probability of Scam class × 100
    risk_score = probs[1].item() * 100

    return {
        "label":      label,
        "verdict":    "SCAM" if label == 1 else "LEGITIMATE",
        "risk_score": f"{risk_score:.1f}%",
    }


# ── SAMPLE INFERENCE ──────────────────────────────────────────────────────────
print("\n" + "="*55)
print("  SAMPLE INFERENCE")
print("="*55)

test_cases = [
    {
        "text":              "GRABE! Kumita ako ng 50000 pesos sa loob ng 7 araw! DM mo ko! 💰 bit.ly/earn123",
        "account_age":       30,
        "posting_frequency": 15.0,
    },
    {
        "text":              "Kumain kami ni Maria sa Jollibee kanina. Masarap pa rin ang Chickenjoy! 😄",
        "account_age":       800,
        "posting_frequency": 1.2,
    },
]

for i, case in enumerate(test_cases, 1):
    result = predict(case["text"], case["account_age"], case["posting_frequency"])
    print(f"\n  Test {i}:")
    print(f"  Text      : {case['text'][:60]}...")
    print(f"  Acct Age  : {case['account_age']} days")
    print(f"  Post Freq : {case['posting_frequency']}/day")
    print(f"  Verdict   : {result['verdict']}")
    print(f"  Risk Score: {result['risk_score']}")

print("\n✅ All done!")