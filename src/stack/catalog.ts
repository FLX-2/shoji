import { useEffect, useState } from "react";
import { applyCatalog, type Catalog, parseCatalog, pricesListed } from "../../runtime/src/models";

/** The list lives in Shoji's own repository, so a new model or price ships without a release. */
export const CATALOG_URL = "https://raw.githubusercontent.com/FLX-2/shoji/main/catalog/models.json";

const STORE = "shoji.catalog";
/** The list is checked at most once a day. */
const DAY = 24 * 60 * 60 * 1000;
/** Far more than the list needs; anything bigger isn't the list. */
const MOST_BYTES = 64 * 1024;

/** The day the prices in use were listed, such as 28 Oct 2026. */
export const listedDay = () =>
  new Date(`${pricesListed()}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export interface SavedCatalog {
  catalog: Catalog;
  /** When the list was last downloaded, in ms. */
  checkedAt: number;
}

export function loadCatalog(): SavedCatalog | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { catalog?: unknown; checkedAt?: unknown };
    if (!saved || typeof saved.checkedAt !== "number") return null;
    return { catalog: parseCatalog({ version: 1, ...(saved.catalog as object) }), checkedAt: saved.checkedAt };
  } catch {
    return null;
  }
}

/**
 * Downloads the list. The request is a plain GET with no cookies, no referrer and nothing about
 * the person or their work, so all GitHub sees is that a copy of Shoji asked for it.
 */
export async function downloadCatalog(now: number): Promise<SavedCatalog> {
  const response = await fetch(CATALOG_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const text = await response.text();
  if (text.length > MOST_BYTES) throw new Error("The model list is too big.");
  const saved = { catalog: parseCatalog(JSON.parse(text)), checkedAt: now };
  try {
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    // Unsaved, it's simply downloaded again next time.
  }
  return saved;
}

/**
 * Puts the saved list in place at once, then downloads a fresh one when it's a day old and the
 * person keeps it current. A list that can't be downloaded or read changes nothing: the last
 * good one, or the built-in one, stays. Returns the list in use.
 */
export function useModelCatalog(current: boolean): Catalog | null {
  const [saved, setSaved] = useState(() => {
    const loaded = loadCatalog();
    applyCatalog(loaded?.catalog ?? null);
    return loaded;
  });

  useEffect(() => {
    const now = Date.now();
    if (!current || (saved && now - saved.checkedAt < DAY)) return;
    let live = true;
    downloadCatalog(now).then(
      (fresh) => {
        if (!live) return;
        applyCatalog(fresh.catalog);
        setSaved(fresh);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [current, saved]);

  return saved?.catalog ?? null;
}
