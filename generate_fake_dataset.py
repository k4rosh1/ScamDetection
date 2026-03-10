# =============================================================================
# Generate Synthetic Taglish Scam Detection Dataset
# =============================================================================
# Generates a CSV with 3 columns + label:
#   - text             : Taglish / English post caption
#   - account_age      : Account age in days
#   - posting_frequency: Average posts per day
#   - label            : 1 = Scam, 0 = Legitimate
#
# Usage: python generate_fake_dataset.py
# =============================================================================

import pandas as pd
import numpy as np
import random

random.seed(42)
np.random.seed(42)

# ── Scam post templates ───────────────────────────────────────────────────────
SCAM_TEMPLATES = [
    "GRABE! Kumita ako ng {amount} pesos sa loob ng {days} araw! DM mo ko para malaman kung paano! 💰🔥 bit.ly/earn{code}",
    "Libre na GCash load! I-click lang ang link na ito at makakuha ng ₱{amount} agad! bit.ly/free{code}",
    "CONGRATULATIONS! Nanalo ka ng ₱{amount}! I-claim mo na agad bago mawala! Mag-DM ka na! 🎉",
    "Invest ka na! Guaranteed {rate}% return in {days} days! Legit to promise! DM for details 💸",
    "Kumita ng {amount} pesos kahit nasa bahay ka lang! Work from home opportunity! DM mo ko ASAP!",
    "URGENT: Your account will be suspended. Verify now at tinyurl.com/verify{code} para hindi ma-block!",
    "LIMITED SLOTS ONLY! {slots} slots na lang! Mag-sign up na para kumita ng ₱{amount}/day! 🔥",
    "FREE ₱{amount} GCash! Pinagkakatiwalaan ko na kayo kaya ibabahagi ko ang secret ko. DM lang!",
    "Raffle winner ka! Claim your prize of ₱{amount}! Send your GCash number now! 🎊",
    "Trabaho sa bahay! ₱{amount} per day guaranteed! No experience needed! DM na agad! 💼",
    "I-click ang link para makuha ang iyong ₱{amount} reward! Expires in 24 hours! bit.ly/claim{code}",
    "Laking swerte mo! Pinili ka naming maging part ng aming {rate}% daily profit program! DM now!",
]

# ── Legitimate post templates ─────────────────────────────────────────────────
LEGIT_TEMPLATES = [
    "Kumain kami ni {name} sa Jollibee kanina. Masarap pa rin ang Chickenjoy! Highly recommend 😄",
    "Maayos na ang traffic sa EDSA ngayon. Baka dahil sa holiday. Ingat sa pagmamaneho! 🚗",
    "Just finished watching {show}. Ang ganda ng story! Highly recommend sa lahat! 🎬",
    "Happy birthday sa aking kaibigan na si {name}! Maraming salamat sa lahat ng alaala! 🎂",
    "Good morning everyone! Sana maganda ang araw ninyo ngayon. Stay safe and blessed! ☀️",
    "Nag-aral ako ng {subject} ngayon. Mahirap pero kaya naman! Tuloy lang ang laban! 📚",
    "Ang ganda ng weather ngayon! Perfect para sa lakad sa park kasama ang pamilya. 🌤️",
    "Salamat sa lahat ng nag-greet sa akin ngayon! Feeling loved talaga! 💕",
    "Just cooked {food} for dinner. Masarap! Sharing the recipe later sa mga interested. 🍳",
    "Reminder: Mag-ingat sa mga scam messages online. Huwag basta-basta mag-click ng unknown links!",
    "Natapos ko na ang {subject} project! Finally! Time to rest and celebrate. 🎉",
    "Ang saya ng family bonding ngayon! Kumain kami sa labas at nag-movie after. 👨‍👩‍👧‍👦",
]

def generate_scam_text():
    template = random.choice(SCAM_TEMPLATES)
    return template.format(
        amount=random.randint(5, 500) * 1000,
        days=random.randint(3, 30),
        rate=random.randint(20, 200),
        slots=random.randint(5, 50),
        code=random.randint(100, 999),
    )

def generate_legit_text():
    template = random.choice(LEGIT_TEMPLATES)
    names    = ["Maria", "Jose", "Ana", "Juan", "Carlo", "Lea", "Mark", "Nina"]
    shows    = ["Crash Landing on You", "Flower of Evil", "My Love from the Star"]
    subjects = ["Math", "Science", "Programming", "English", "History"]
    foods    = ["adobo", "sinigang", "fried rice", "pasta", "tinola"]
    return template.format(
        name=random.choice(names),
        show=random.choice(shows),
        subject=random.choice(subjects),
        food=random.choice(foods),
    )

# ── Generate dataset ──────────────────────────────────────────────────────────
records = []

for _ in range(2500):
    records.append({
        "text":              generate_scam_text(),
        "account_age":       int(np.random.exponential(scale=60)),   # young accounts
        "posting_frequency": round(np.random.uniform(5, 30), 2),     # high frequency
        "label":             1,
    })

for _ in range(2500):
    records.append({
        "text":              generate_legit_text(),
        "account_age":       int(np.clip(np.random.normal(loc=800, scale=300), 90, 3650)),
        "posting_frequency": round(np.random.uniform(0.1, 3), 2),    # low frequency
        "label":             0,
    })

df = pd.DataFrame(records).sample(frac=1, random_state=42).reset_index(drop=True)
df.to_csv("scam_dataset.csv", index=False)

print(f"✅ Dataset saved to scam_dataset.csv")
print(f"   Total samples : {len(df)}")
print(f"   Scam          : {df['label'].sum()}")
print(f"   Legitimate    : {(df['label'] == 0).sum()}")
print(f"   Columns       : {list(df.columns)}")
print(f"\n   Sample row:")
print(df.head(1).to_string())