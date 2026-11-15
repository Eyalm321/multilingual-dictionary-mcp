/**
 * Expected artifacts of the current data bundle (manifest version 3).
 *
 * The installer trusts these values, not the manifest served by the data host: a manifest
 * or a downloaded file that doesn't match a pin is refused, and a valid local cache is never
 * replaced with unpinned data. MDM_CDN_BASE may point at any mirror, but it must serve
 * exactly these files.
 *
 * Rebuilding the bundle (data-pipeline/) changes these hashes; update this file in the
 * same change that publishes the new bundle.
 */
export interface PinnedArtifact {
  sha256: string;
  size: number;
}

export type Pins = Readonly<Record<string, PinnedArtifact>>;

export const DATA_BUNDLE_VERSION = 3;

export const PINNED_ARTIFACTS: Pins = Object.freeze({
  "cmudict.sqlite": {
    sha256: "a7172bb83b588baea0c2ccb448b07ec6341e0e7f52704c2f09a2ec28b0944560",
    size: 19238912,
  },
  "conceptnet.sqlite": {
    sha256: "40d865b8b3155994ed1d65287022bc961b5b406462e0a666c2203431a9f23b12",
    size: 5577691136,
  },
  "numberbatch.bin": {
    sha256: "4df79127364e5cfb8a5d52d7a800af395b2a4e6de48db517dbd291f283a2da8f",
    size: 2748573600,
  },
  "numberbatch.idx.tsv": {
    sha256: "66758b1aaf45f0d81c9958a5d770fa15db5a4b9ebacfd277ce6d287c9bbfc771",
    size: 249827821,
  },
  "numberbatch.meta.json": {
    sha256: "bab1304f5525a9e958de009663e33286e19a0282dc927e5703dfadcdcdc28c27",
    size: 44,
  },
  "wiktextract-all.sqlite": {
    sha256: "224641036bb5f6708e018177bebc0f3145fcd3eef81137768afd1abea5aaa001",
    size: 7005937664,
  },
});
