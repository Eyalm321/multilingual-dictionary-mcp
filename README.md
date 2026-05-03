# Multilingual Dictionary MCP

An MCP server for **multilingual dictionary lookups with word relations** — synonyms, antonyms, hypernyms, hyponyms, meronyms, translations, etymology, definitions, rhymes, and more — covering **all languages** by stitching together three free public APIs:

- **[ConceptNet](https://conceptnet.io/)** — multilingual semantic network (80+ languages, word relations: Synonym, Antonym, IsA, PartOf, RelatedTo, DerivedFrom, etc.)
- **[Wiktionary](https://en.wiktionary.org/)** — definitions, etymology, and pronunciation in 4000+ languages
- **[Datamuse](https://www.datamuse.com/api/)** — English-only utilities (rhymes, sound-alikes, "means like", spelling patterns, contextual triggers)

No API keys. No bundled data. Just plug it into Claude (or any MCP client) and ask it about words in any language.

---

## Installation

### From npm

```bash
npm install -g multilingual-dictionary-mcp
```

### From GitHub Packages

```bash
npm install -g @eyalm321/multilingual-dictionary-mcp --registry=https://npm.pkg.github.com
```

### Claude Desktop / Claude Code config

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

---

## Tools

### Multilingual word relations (ConceptNet)

All of these accept a `word`, an ISO 639-1 `language` code (defaults to `en`), and a `limit`. Works for English, Spanish, French, German, Italian, Russian, Hebrew, Arabic, Latin, Chinese, Japanese, and 70+ more.

| Tool | Description |
| --- | --- |
| `dictionary_synonyms` | Words with similar meaning |
| `dictionary_antonyms` | Opposites |
| `dictionary_related` | Loosely associated terms (RelatedTo edges) |
| `dictionary_hypernyms` | Broader/parent concepts (dog → mammal) |
| `dictionary_hyponyms` | Narrower/child concepts (dog → poodle) |
| `dictionary_meronyms` | Parts/components (car → wheel) |
| `dictionary_holonyms` | Wholes that contain this (wheel → car) |
| `dictionary_derived_from` | Etymological roots |
| `dictionary_etymologically_related` | Cognates and shared roots across languages |
| `dictionary_used_for` | Typical purposes (knife → cutting) |
| `dictionary_capable_of` | Typical actions (dog → bark) |
| `dictionary_at_location` | Typical locations (book → library) |
| `dictionary_translate` | Cross-lingual synonyms — translates a word |
| `dictionary_all_relations` | All relations for a word in one call |

### Definitions & etymology (Wiktionary)

| Tool | Description |
| --- | --- |
| `dictionary_lookup` | Definitions grouped by language (4000+ languages via en.wiktionary) |
| `dictionary_summary` | Brief plain-text summary from any Wiktionary edition |
| `dictionary_etymology` | Etymology section, plain text |
| `dictionary_pronunciation` | Pronunciation section (typically IPA) |
| `dictionary_search` | Search a Wiktionary edition for matching pages |
| `dictionary_random` | Random word from any Wiktionary edition |

### English-specific utilities (Datamuse)

| Tool | Description |
| --- | --- |
| `dictionary_rhymes` | Perfect or near rhymes |
| `dictionary_sounds_like` | Homophones / soundalikes |
| `dictionary_means_like` | ML-based "means approximately" — broader than synonyms |
| `dictionary_spelled_like` | Spelling pattern with `?` and `*` wildcards |
| `dictionary_suggest` | Autocomplete |
| `dictionary_triggers` | Statistically associated terms (cow → milk, farm) |
| `dictionary_follows` | Words that commonly follow (drink → coffee) |
| `dictionary_precedes` | Words that commonly precede (audience → captive) |

---

## Examples

```
> What are the synonyms of "feliz" in Spanish?
[uses dictionary_synonyms with language: "es"]

> Translate "happiness" into Hebrew
[uses dictionary_translate with language: "en", targetLanguage: "he"]

> What's the etymology of the word "serendipity"?
[uses dictionary_etymology]

> Find me words that rhyme with "orange"
[uses dictionary_rhymes]

> What are the parts of a bicycle?
[uses dictionary_meronyms with word: "bicycle"]
```

---

## Development

```bash
npm install
npm run build      # TypeScript compile
npm test           # vitest run
npm run test:watch # vitest watch
npm run dev        # ts-node entry point
```

### Project layout

```
src/
├── index.ts            # MCP server entry
├── client.ts           # HTTP wrappers for ConceptNet / Wiktionary / Datamuse
├── tools/
│   ├── relations.ts    # ConceptNet-backed multilingual relation tools
│   ├── definitions.ts  # Wiktionary-backed definition/etymology tools
│   └── english.ts      # Datamuse-backed English utilities
└── __tests__/          # vitest specs
```

---

## CI / Release

- **CI** runs on every push and PR against `main`, on Node 20 and 22.
- **Publish** runs when a GitHub Release is published — tests, builds, then publishes to **both** [npm](https://www.npmjs.com/) (as `multilingual-dictionary-mcp`) and [GitHub Packages](https://github.com/Eyalm321/multilingual-dictionary-mcp/packages) (as `@eyalm321/multilingual-dictionary-mcp`).

To cut a release:

1. Bump the `version` in `package.json` and commit.
2. Tag and push (e.g. `git tag v0.1.1 && git push --tags`).
3. Create a GitHub Release pointing at the tag — the publish workflow handles the rest.

The publish workflow expects two repository secrets: `NPM_TOKEN` (npm automation token) and `GITHUB_TOKEN` (auto-provided by GitHub Actions).

---

## License

MIT © Eyalm321
