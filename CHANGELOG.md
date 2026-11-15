# Changelog

## 0.3.6 (unreleased)

Fixes the data download for new installs (#1). Patch release: no tool or API changes, same Node support.

### Data bundle
- **New default data host.** The old one is gone, so new installs failed. The bundle is now served from `https://s3.casthook.dev/dict-data`. `MDM_CDN_BASE` still overrides it (#5).
- **Pinned hashes.** The sha256 and size of every data file ship in the package (`src/data/pinned.ts`). The host's manifest is no longer trusted for them: a manifest or file that doesn't match the pins is refused before anything is written (#3).
- **Cache kept.** A complete local cache that matches the pins is used without contacting the host. A failed or refused download never replaces a valid cached file (#3).
- **Clearer errors.** An unreachable host, an HTTP error or a refused file reports the URL, `MDM_CDN_BASE` and the README's "Building the data bundle yourself" section, instead of a bare `fetch failed` (#3).

### Maintenance
- `@modelcontextprotocol/sdk` 1.29.0 → 1.32.2 and `zod` → 4.6.7. `npm audit` is down to 0 critical and 0 high; the remaining moderates are in the SDK's HTTP transport, which this stdio server never loads (#2).
- Dependabot added, with a 14-day cooldown (#2).
- npm publishing uses trusted publishing (OIDC), and all workflow actions are pinned to commit SHAs (#4).

## 0.3.5 and earlier

See the [GitHub releases](https://github.com/Eyalm321/multilingual-dictionary-mcp/releases).
