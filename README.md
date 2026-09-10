# BinGo 🗑️✨

> **See it. Sort it. BinGo!**

An AI-powered waste-sorting assistant that helps you identify which bin an item belongs in — just point your camera at it.

**[Live Demo →](https://bingo-waste.vercel.app)**

---

## What it does

BinGo uses a trained image classification model (Google Teachable Machine) to recognize waste in real time through your camera. It tells you:

- Which **bin color** to use (Green / Blue / Black)
- What **category** the item falls under (Biodegradable / Recyclable / Residual)
- A short **tip** explaining why

It's designed as an **educational tool** — not a guaranteed recycling authority.

---

## Categories

| Bin | Color | Category |
|-----|-------|----------|
| 🟢 Green | Biodegradable | Food scraps, leaves, garden waste |
| 🔵 Blue | Recyclable | Bottles, cans, cardboard, paper |
| ⚫ Black | Residual | Mixed waste, styrofoam, soiled wrappers |

---

## Tech Stack

- **Vanilla HTML / CSS / JavaScript** — no framework
- **TensorFlow.js** (`v1.7.4`) — runs the model in the browser
- **Teachable Machine Image** (`v0.8.4-alpha2`) — image classification
- **Google Teachable Machine** — model training
- **Vercel** — static hosting

No backend. No database. Runs entirely in the browser.

---

## AI Model

The model lives in `waste_sorting_ai/` and was trained using [Google Teachable Machine](https://teachablemachine.withgoogle.com/).

```
waste_sorting_ai/
├── model.json       ← Model architecture + weights manifest
├── weights.bin      ← Trained weights
└── metadata.json    ← Class labels + version info
```

**Classes:** `RECYCLABLE` · `RESIDUAL` · `BIODEGRADEABLE` · `NONE`

A **75% confidence threshold** is used before showing a result. Predictions are smoothed over 6 consecutive frames to prevent flickering.

---

## Run Locally

No install needed — it's a static site.

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/BinGo.git
cd BinGo

# Serve with any static server (camera requires a server, not file://)
npx serve .
# or
python -m http.server 3000
```

Then open `http://localhost:3000` in your browser.

> ⚠️ Camera access requires a **secure context** (localhost or HTTPS). Opening `index.html` directly as a file will not work.

---

## Deploy to Vercel

```bash
npx vercel
```

Or connect your GitHub repo at [vercel.com](https://vercel.com) — Vercel auto-detects it as a static site. No configuration needed.

---

## Project Structure

```
BinGo/
├── index.html            ← Single-page app
├── style.css             ← Styles (dark theme, mobile-first)
├── app.js                ← AI logic, camera, prediction loop
├── .vercelignore         ← Excludes .agents/ from deployment
└── waste_sorting_ai/
    ├── model.json
    ├── weights.bin
    └── metadata.json
```

---

## Disclaimer

BinGo is an **educational sorting assistant**. AI predictions are based on visual appearance only and are not guaranteed to be accurate. Always follow your local waste-sorting guidelines when in doubt.

> ⚠️ When in doubt, ask an adult or check your local waste-sorting rules.

---

## License

MIT
