# BinderBuddy

Build and share interactive TCG binders online.

## Run

```bash
npm install
npm run dev
```

## Accounts (Supabase)

Sign-in, two-factor authentication and each account's cards and binders live in Supabase.
Add to `.env.local`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then run the files in `supabase/migrations/` once each, in name order, in the Supabase SQL editor.
They create the tables and the Row Level Security rules: each account can only read and change its
own rows. Never put the secret (`sb_secret_…`) key in the app.

Extra sign-in protection is optional. After confirming their email, users are offered a passkey or
an authenticator app (or can skip), and can change this later on the Account page. Once an account
has an authenticator app, its data needs either the app's code or a passkey sign-in — the password
alone isn't enough. Passkeys must be switched on under Authentication in the Supabase dashboard.

To make an account an admin or give it Premium for testing, change its row in the `profiles` table
from the Supabase dashboard — users can't change those fields themselves.

The browser keeps a copy of the signed-in account for fast loading; it's removed on sign-out. Pokémon cards/sets load from the public Pokémon TCG dataset.

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
