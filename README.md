# BinderBuddy

Build and share interactive TCG binders online.

## Run

```bash
npm install
npm run dev
```

## Admin demo

- Email: `admin@binderbuddy.com`
- Password: `admin123`

Data is stored in your browser (`localStorage`). Pokémon cards/sets load from the public Pokémon TCG dataset.

## Binder page detection

Full binder page scan can use the saved Roboflow workflow **Binder Card Edges** (`jack-firmin` / `binder-card-edges-vbinder-card-edges-2-rfdetr-seg-small-t1-logic`). The browser posts the photo to the local dev server, and the server calls the workflow with `Authorization: Bearer`. The API key never goes to the browser.

Create `.env.local` in the project folder:

```
ROBOFLOW_API_KEY=your_private_api_key
JUSTTCG_API_KEY=your_private_api_key
```

Restart `npm run dev` after adding or changing either key so Vite reloads them. Both keys stay on the server — never sent to the browser.

On Scan, choose **Full binder page**, set **Detector** to **Binder Card Edges**, then **Detect cards**. Outlines are the card bounding boxes. Polygon points stay on the server. **Demo grid** does not call Roboflow.

After **Review cards**, each crop is read with the existing on-device Tesseract OCR (no OCR API key). Matches come from the public [Pokémon TCG data](https://github.com/PokemonTCG/pokemon-tcg-data) catalogue already used elsewhere in the app (free, no API key). Suggestions are never auto-confirmed — accept a printing, pick another, edit, or save unidentified. Your crop is stored as the collection photo; the catalogue id is stored separately on accept.

Check the workflow with one sample image:

```bash
npm run smoke:card-edges
```

## Binder valuation (prototype)

After you accept an exact catalogue printing on Scan, pick raw condition (NM / LP / MP / HP / Damaged). The server matches an exact JustTCG card + variant (no similar-name fallback) and caches prices. The binder page shows a **Valuation (prototype)** total, excluded-card count, and a manual refresh that respects free-tier rate limits.

```bash
npm run smoke:justtcg
```
