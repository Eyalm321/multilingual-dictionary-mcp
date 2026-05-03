# Multilingual Dictionary MCP

An **offline-first** MCP server for multilingual dictionary lookups — definitions, synonyms, antonyms, hypernyms, hyponyms, meronyms, translations, etymology, pronunciation, semantic neighbors, rhymes, and more — across **4,755 languages**.

No third-party APIs. No rate limits. No outages. The server downloads its data from a CDN once on first run and never goes online again.

## What's bundled

| Source | Size | What it covers |
| --- | --- | --- |
| **Wiktextract** (Kaikki.org) | 6.6 GB | 10.5M dictionary entries across 4,755 languages — definitions, etymology, IPA, translations |
| **ConceptNet 5.7** | 5.6 GB | 24.3M semantic edges across 80+ languages — Synonym, Antonym, IsA, PartOf, RelatedTo, UsedFor, CapableOf, AtLocation, DerivedFrom, EtymologicallyRelatedTo |
| **Numberbatch embeddings** | 3 GB | 9.16M concepts × 300d multilingual embeddings — semantic neighbors via cosine similarity |
| **CMU Pronouncing Dictionary** | 19 MB | English rhymes, soundalikes, autocomplete, spell patterns |

Total bundle: **~21 GB** (medium profile, default).

## One bundle, one download

The whole bundle ships in 6 artifacts. Total **5.4 GB on the wire** (gzip-compressed where it helps), **15.6 GB on disk** after extraction. Everything downloads on first run; no profiles, no opt-ins.

## Installation

```bash
npm install -g multilingual-dictionary-mcp
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "multilingual-dictionary": {
      "command": "npx",
      "args": ["-y", "multilingual-dictionary-mcp"]
    }
  }
}
```

On first run, the server downloads its data bundle (~5.4 GB compressed → ~15.6 GB on disk) from `multilingual-dictionary-mcp-data.nyc3.cdn.digitaloceanspaces.com` into `~/.cache/multilingual-dictionary-mcp/` (overridable via `MDM_DATA_DIR`). Each artifact is gzip-decompressed during the stream and SHA-256 verified. Subsequent runs are instant.

## Tools

### Multilingual word relations (ConceptNet — 80+ languages)

`dictionary_synonyms`, `dictionary_antonyms`, `dictionary_hypernyms`, `dictionary_hyponyms`, `dictionary_meronyms`, `dictionary_holonyms`, `dictionary_derived_from`, `dictionary_etymologically_related`, `dictionary_used_for`, `dictionary_capable_of`, `dictionary_at_location`, `dictionary_translate`, `dictionary_all_relations`

### Embedding-based semantic search (Numberbatch — 78 languages)

| Tool | What it does |
| --- | --- |
| `dictionary_related` | Semantic neighbors via cosine similarity — much denser than ConceptNet RelatedTo |
| `dictionary_semantic_neighbors` | Explicit embedding lookup with optional cross-lingual filter |
| `dictionary_means_like` | Multilingual "means approximately" via Numberbatch (works in any of the 78 covered languages) |

### Definitions & etymology (Wiktextract — 4,755 languages)

| Tool | What it does |
| --- | --- |
| `dictionary_lookup` | Definitions + IPA + etymology grouped by language |
| `dictionary_summary` | Concatenated short definition |
| `dictionary_etymology` | Etymology text |
| `dictionary_pronunciation` | IPA pronunciations |
| `dictionary_search` | Prefix-search the corpus |
| `dictionary_random` | Random word entry |

### English-specific (CMU Pronouncing Dictionary)

| Tool | What it does |
| --- | --- |
| `dictionary_rhymes` | Perfect or near rhymes |
| `dictionary_sounds_like` | Homophones / soundalikes |
| `dictionary_spelled_like` | Spelling pattern (`?` and `*` wildcards) |
| `dictionary_suggest` | Autocomplete prefix |

---

## Examples

```
> What are the synonyms of "feliz" in Spanish?
[uses dictionary_synonyms with language: "es"]

> Translate "happiness" into Hebrew
[uses dictionary_translate with language: "en", targetLanguage: "he"]

> What's the etymology of "serendipity"?
[uses dictionary_etymology]

> Find words semantically similar to "café" across languages
[uses dictionary_semantic_neighbors]

> What rhymes with "orange"?
[uses dictionary_rhymes with perfect: false]
```

---

## Development

```bash
npm install
npm run build
npm test           # 42 tests, all run without local data
```

Source layout:

```
src/
├── index.ts            # MCP server entry, blocks on first-run install
├── data/
│   ├── paths.ts        # CDN base, profile selection, data dir
│   ├── installer.ts    # First-run downloader + SHA-256 verification
│   └── local-store.ts  # SQLite + Numberbatch matrix wrappers
└── tools/
    ├── relations.ts    # 13 ConceptNet relation tools + 1 embedding tool
    ├── definitions.ts  # 6 Wiktextract definition tools
    └── english.ts      # 5 CMU dict + Numberbatch tools
```

Total: **24 tools**.

---

## Building the data bundle yourself

The CDN ships official builds, but the entire pipeline is in [`data-pipeline/`](data-pipeline/) — see its [README](data-pipeline/README.md). You can rebuild from upstream sources, ship to your own bucket, and override `MDM_CDN_BASE`.

---

## CI / Release

- **CI** runs build + tests on Node 20 & 22 for every push and PR.
- **Publish** runs on GitHub Release publish, pushes to npm and GitHub Packages.

---

## License

MIT © Eyalm321
