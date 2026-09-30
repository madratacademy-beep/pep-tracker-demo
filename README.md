# Pep Tracker — Web Demo

Polished single-page prototype that looks like a simple iOS app. Dark phone-framed UI (~390×844; fullscreen on narrow / phone viewports). Data lives in `localStorage` (`madrat-pet-tracker-v4`).

**Disclaimer in UI:** personal tracker · not medical advice

**No visible catalog** — start empty; type a custom name (typeahead suggests ~40 common names while typing; custom names still save).

## How to open

### Option A — open the file
Double-click `index.html`, or from a terminal:

```bash
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

### Option B — local server (recommended)
From this folder:

```bash
cd /path/to/pet-tracker/demo
python3 -m http.server 8765
```

Then open http://localhost:8765 in a browser.

## Screens
1. **Today** — doses due today from user’s peptides; Mark done (persisted). Empty until something is scheduled for today.
2. **Peptides** — Add peptide (name, dose mg, conc, frequency, days); list; live mg → units calculator that updates & saves that peptide; delete. U-100: `units = dose_mg / concentration_mg_per_ml * 100`
3. **Week** — visible 7-day strip (today ±3) with status dots + day detail
4. **Reminders** — time + enable toggle (stored preference; no real push)

## Reset sample data
In DevTools console: `localStorage.removeItem('madrat-pet-tracker-v4'); localStorage.removeItem('madrat-pet-tracker-reminder-v1');` then reload.
