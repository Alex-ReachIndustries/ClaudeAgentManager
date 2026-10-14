// Parsing for how agents reference Knowledge Hub entries in free text.
//
//  - parseKbLine: the completion record line, `KB: [12, 34]` (entries used) or `KB: none`
//    (a conscious decision that none applied). Shared by the completion gate in agents.ts and
//    the citation_rate metric in store.ts, so the gate and the metric can never disagree.
//  - citedEntryIds: ids a message already cites ([12], KB 12, KB12), so auto-surfacing does
//    not push an entry the sender has already pointed the agent at.

export type KbLine = { kind: "ids"; ids: number[] } | { kind: "none" };

// A line whose label is "KB" followed by a colon. Tolerates list/quote markers and markdown
// emphasis ("- **KB:** [12]"). Does NOT match "KB_CONSULTED:" or "KB-check".
const KB_LINE_RE = /^\s*(?:[-*>]\s+)?[*_`]*\s*KB\s*[*_`]*\s*:\s*[*_`]*(.*)$/i;

function uniq(ns: number[]): number[] {
  return [...new Set(ns)].filter((n) => Number.isInteger(n) && n > 0);
}

/** Parse the last `KB:` line in `text`. Returns null when there is no usable KB line. */
export function parseKbLine(text: string | null | undefined): KbLine | null {
  if (!text) return null;
  let rest: string | null = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(KB_LINE_RE);
    if (m) rest = m[1] ?? "";
  }
  if (rest == null) return null;
  const ids: number[] = [];
  // Bracketed ids: [12], [12, 34], [#12; 34]
  for (const m of rest.matchAll(/\[\s*#?(\d{1,9}(?:\s*[,;\s]\s*#?\d{1,9})*)\s*\]/g)) {
    for (const n of m[1].split(/[^\d]+/)) if (n) ids.push(Number(n));
  }
  // Bare list: "KB: 12, 34"
  if (ids.length === 0 && /^[\s#\d,;]+$/.test(rest) && /\d/.test(rest)) {
    for (const n of rest.split(/[^\d]+/)) if (n) ids.push(Number(n));
  }
  const u = uniq(ids);
  if (u.length) return { kind: "ids", ids: u };
  if (/\bnone\b/i.test(rest)) return { kind: "none" };
  return null;
}

/**
 * Plain text of an update's content. Updates are stored as JSON ({"text": "..."} for text
 * updates), and agents may post JSON content themselves — parse it so a `KB:` line inside is
 * seen with real newlines, not as an escaped "\n" inside one long JSON string.
 */
export function updateText(content: string | null | undefined): string {
  if (!content) return "";
  const s = String(content);
  try {
    const parsed: unknown = JSON.parse(s);
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed as Record<string, unknown>).filter((v): v is string => typeof v === "string").join("\n");
    }
  } catch { /* plain text */ }
  return s;
}

/** Entry ids a message already cites: "[12]", "KB 12", "KB12", "kb #12". */
export function citedEntryIds(text: string | null | undefined): number[] {
  if (!text) return [];
  const ids: number[] = [];
  for (const m of String(text).matchAll(/\[(\d{1,7})\]|\bKB\s*#?(\d{1,7})\b/gi)) {
    ids.push(Number(m[1] ?? m[2]));
  }
  return uniq(ids);
}
