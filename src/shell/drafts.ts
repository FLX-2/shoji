/** What the person wrote in a composer and hasn't sent, by place, so leaving and coming back keeps it, as does
 *  closing Shoji. */
const STORE = "shoji.drafts";

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

export function draftFor(place: string): string {
  return read()[place] ?? "";
}

export function keepDraft(place: string, text: string) {
  const all = read();
  if ((all[place] ?? "") === text) return;
  if (text.trim()) all[place] = text;
  else delete all[place];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // Storage can be unavailable; the draft then lasts while the composer is open.
  }
}
