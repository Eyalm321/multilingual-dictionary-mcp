# multilingual-dictionary-mcp data pipeline

Builds the offline data bundle published to `multilingual-dictionary-mcp-data.nyc3.cdn.digitaloceanspaces.com`.

## What it produces

| Artifact | Source | Size | Profile |
| --- | --- | --- | --- |
| `conceptnet.sqlite` | ConceptNet 5.7 assertions dump | ~3 GB | medium |
| `numberbatch.bin` + `numberbatch.idx.json` | ConceptNet Numberbatch 19.08 | ~200 MB | medium |
| `cmudict.sqlite` | CMU Pronouncing Dictionary | ~5 MB | small |
| `wiktextract-{lang}.sqlite` | Kaikki.org Wiktextract dumps | 50 MB – 2 GB per lang | medium / full |
| `ngrams.sqlite` | English Wikipedia bigrams | ~3-5 GB | full |
| `manifest.json` | This pipeline | ~10 KB | always |

## Running

Each loader downloads its source, parses, and writes into `build/`. They're idempotent — re-running skips work that's already done.

```bash
cd data-pipeline
npm install

# pick what you want:
npm run build:cmudict       # tiny, runs in seconds
npm run build:conceptnet    # ~30 min: downloads 1.2GB, builds 3GB SQLite
npm run build:numberbatch   # ~10 min: downloads 1.4GB, builds 200MB matrix
npm run build:wiktextract   # per-language; default top 13 languages
npm run build:ngrams        # requires WIKI_TEXT_DIR (see below)

npm run build:manifest      # walks build/, writes manifest.json with hashes
```

### Wikipedia n-grams (the big one)

`build:ngrams` doesn't download the dump itself because at 22 GB it's better handled with `wikiextractor`. Workflow:

```bash
# 1. Download the dump (one-time, ~22 GB)
wget https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2

# 2. Extract to plain text shards
pip install wikiextractor
wikiextractor --json -o /path/to/wiki-text enwiki-latest-pages-articles.xml.bz2

# 3. Build the n-gram SQLite
WIKI_TEXT_DIR=/path/to/wiki-text npm run build:ngrams
```

## Uploading to the CDN

```bash
DO_SPACES_KEY=... DO_SPACES_SECRET=... npm run upload
```

The upload script streams every file in `build/` to the configured bucket as `public-read` with a 24-hour `Cache-Control: max-age` and `immutable` flag (artifacts are content-addressed via the manifest's sha256).

To point at a different bucket / region:

```bash
DO_SPACES_BUCKET=my-bucket DO_SPACES_REGION=sfo3 npm run upload
```

## Notes on disk and time

| Step | Disk while running | Time |
| --- | --- | --- |
| ConceptNet | 1.2 GB download + 9 GB extracted + 3 GB SQLite | 30–60 min |
| Numberbatch | 1.4 GB download + 200 MB output | 10–15 min |
| CMU dict | 3 MB | <1 min |
| Wiktextract (per language) | 50 MB – 2 GB | 5–60 min |
| n-grams | 50–100 GB intermediate | 2–6 hrs |

For the full bundle, set aside ~150 GB of free disk during the build and ~25 GB for the final output. The `build/` directory is what gets uploaded.

## Licensing

Each upstream source has its own license; the pipeline honors them all:

- ConceptNet 5.7 — CC BY-SA 4.0
- ConceptNet Numberbatch — Custom permissive
- CMU Pronouncing Dictionary — BSD-style
- Wiktextract / Wiktionary — CC BY-SA 3.0/4.0 (varies by entry)
- Wikipedia (n-gram source) — CC BY-SA 3.0

The published bundle inherits these licenses; commercial users should review them per upstream.
