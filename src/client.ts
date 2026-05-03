const CONCEPTNET_BASE = process.env.CONCEPTNET_BASE_URL || "https://api.conceptnet.io";
const WIKTIONARY_BASE = process.env.WIKTIONARY_BASE_URL || "https://en.wiktionary.org";
const DATAMUSE_BASE = process.env.DATAMUSE_BASE_URL || "https://api.datamuse.com";

const USER_AGENT =
  "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)";

async function httpGet<T>(
  url: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const u = new URL(url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        u.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} for ${u.toString()}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function conceptnetRequest<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return httpGet<T>(`${CONCEPTNET_BASE}${path}`, params);
}

export async function wiktionaryRequest<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return httpGet<T>(`${WIKTIONARY_BASE}${path}`, params);
}

export async function datamuseRequest<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return httpGet<T>(`${DATAMUSE_BASE}${path}`, params);
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "_");
}

export function conceptnetUri(word: string, language: string): string {
  return `/c/${language}/${normalizeWord(word)}`;
}
