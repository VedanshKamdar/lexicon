# Lexicon

A personal vocabulary book. Type a word, get a card that teaches discrimination
rather than definition — synonyms carry notes explaining how each differs, roots
come from real etymology, examples read like editorial prose. Local-first: every
card is stored in the browser and works offline.

Single user. No accounts, no auth.

## Running it

```bash
npm install
cp .env.example .env      # then fill in the keys below
npm run dev
```

`npm run dev` binds to the network, so the printed `Network:` URL opens the app
on a phone on the same Wi-Fi.

## Keys

Only `GROQ_API_KEY` is required. Everything else degrades gracefully.

| Variable | Needed for | Free tier |
|---|---|---|
| `GROQ_API_KEY` | card generation | 200K tokens/day on `gpt-oss-120b` |
| `MW_DICTIONARY_KEY` | etymology, audio, IPA | 1,000 requests/day |
| `MW_THESAURUS_KEY` | sense-grouped synonyms | 1,000 requests/day |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | sync between devices | 5GB, no idle pause |
| `APP_SECRET` + `VITE_APP_SECRET` | gating `/api/*` once deployed | — |

The two secret variables must hold the same value. `VITE_APP_SECRET` is compiled
into the client bundle by necessity — see [`src/api/headers.ts`](src/api/headers.ts)
for what that does and does not protect.

## How a lookup works

```
normalize → IndexedDB hit?  → render, no network at all
          → miss
            POST /api/resolve    Merriam-Webster → dictionaryapi.dev → Wiktionary
                                 → Datamuse, in parallel; first to answer wins.
                                 Returns headword, IPA, part of speech immediately
                                 so the wait is not a blank screen.
            POST /api/generate   Groq rewrites it into a card under a strict JSON
                                 schema, validated with Zod before it is stored.
```

All upstream fetching happens server-side. `api.dictionaryapi.dev` does not
reliably send CORS headers, and from the browser it fails outright — silently
costing IPA and audio on words that resolve perfectly well from Node.

A dictionary 404 is **not** treated as proof a word does not exist; that API
returns 404 intermittently for words it served minutes earlier. Datamuse
cross-checks before anything is reported missing.

## Scripts

```bash
npm run typecheck                        # app + serverless code
npx tsx scripts/try.ts obdurate sanction # run the pipeline on words, with a quality audit
npx tsx scripts/mw.ts                    # verify the Merriam-Webster keys
npx tsx scripts/sync.ts                  # verify Turso and the merge rules
npx tsx scripts/peek.ts                  # show what is actually in the remote store
npx tsx scripts/cleanup-probe.ts         # remove rows left by sync.ts self-tests
npx tsx scripts/seed.ts                  # bulk-generate the CAT word list
npx tsx scripts/icons.ts                 # regenerate PWA icons
```

`scripts/try.ts` and `scripts/seed.ts` both audit generated cards for the ways
these models drift: generic synonym notes, circular definitions, the headword
listed as its own synonym, invented antonyms. Prompt changes should be checked
against it before they ship.

## Deploying

Vercel, with `dist` as the static output and `api/*.ts` as serverless functions.
Set every variable above in the project's environment, then verify:

1. a lookup succeeds — the keys landed
2. a hard refresh on `/w/salient` returns the app, not a 404 — the SPA rewrite applied
3. `POST /api/resolve` without `x-app-secret` returns **401** — the endpoint is gated

## Data

IndexedDB via Dexie is the source of truth on each device. Sync is additive and
optional; the app is fully usable with no network and no Turso.

Deletes are soft. A hard delete cannot sync — the device still holding the card
would push it back on the next merge.

Export and import live at the bottom of the word list. On iOS, install to the
home screen: Safari evicts IndexedDB for uninstalled sites after about a week.
