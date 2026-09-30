/**
 * Collector numbers read off the bottom strip of a card ("58/102", "188/185", "SV118/SV122",
 * "SM60") and how well they agree with a catalogue printing. Pure string logic so the
 * browser scanner and the Node benchmark share it.
 */

export type ReadNumber = { number: string; total?: string }

// Letters OCR commonly produces for digits inside a number
const DIGIT_SLIPS: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', Z: '2', S: '5', B: '8', g: '9' }

/** "058" → "58", "sv118" → "SV118", "TG01" → "TG1". */
export function normalizeCollectorNumber(value: string): string {
  const m = value.trim().match(/^([A-Za-z]*)0*(\d+)([A-Za-z]?)$/)
  if (!m) return value.trim().toUpperCase()
  return `${m[1].toUpperCase()}${m[2]}${m[3].toLowerCase()}`
}

// Letter prefixes that really appear in printed numbers (subsets, promos, gallery cards)
const NUMBER_PREFIX = /^(SWSH|SVP|SV|SM|XY|BW|DP|HGSS|TG|GG|RC|H)(?=.)/

/** Fix letter-for-digit slips in a token, keeping a real prefix (SV118) but not a slip (S8 → 58). */
function fixDigits(token: string): string {
  const prefix = token.match(NUMBER_PREFIX)?.[1] ?? ''
  return prefix + token.slice(prefix.length).replace(/[OoDQlIi|ZSBg]/g, (c) => DIGIT_SLIPS[c] ?? c)
}

/**
 * Every plausible collector number in OCR text from a card's bottom strip. Accepts
 * "number/total" (with the slash often read as | or l) and bare promo codes (SM60, SWSH050).
 */
export function parseCollectorNumbers(text: string): ReadNumber[] {
  const found = new Map<string, ReadNumber>()
  const add = (n: ReadNumber) => {
    const key = `${n.number}/${n.total ?? ''}`
    if (!found.has(key)) found.set(key, n)
  }
  const cleaned = text.replace(/[‘’`´]/g, "'")

  // Not glued to more digits on either side: "1868/1850" is a garbled read, not 88/18
  const slashed =
    /(?<![0-9])([A-Z]{0,4}[0-9OoDQlIiZSBg]{1,3}[a-z]?)\s*[/|\\]\s*([A-Z]{0,4}[0-9OoDQlIiZSBg]{2,3})(?![0-9])/g
  for (const m of cleaned.matchAll(slashed)) {
    const number = normalizeCollectorNumber(fixDigits(m[1]))
    const total = normalizeCollectorNumber(fixDigits(m[2]))
    if (!/\d/.test(number) || !/\d/.test(total)) continue
    add({ number, total })
  }

  // Bare promo codes, looked for only outside the a/b numbers so SV122 in SV118/SV122 isn't one
  const rest = cleaned.replace(slashed, ' ')
  const promo = /\b(SWSH|SVP|SV|SM|XY|BW|DP|HGSS|TG|GG|RC)\s?-?\s?(\d{1,3}[a-z]?)\b/gi
  for (const m of rest.matchAll(promo)) add({ number: normalizeCollectorNumber(`${m[1]}${m[2]}`) })

  return [...found.values()]
}

/**
 * How strongly the numbers read from a card agree with one printing:
 * 1 = number and set total both match, 0.6 = number matches (total unread or a secret-rare
 * total), 0 = nothing comparable was read, -0.3 = a clean number/total was read and it's a
 * different card.
 */
export function collectorNumberAgreement(
  reads: ReadNumber[],
  card: { number: string; printedTotal?: number },
): number {
  if (!reads.length) return 0
  const number = normalizeCollectorNumber(card.number)
  const total = card.printedTotal ? String(card.printedTotal) : undefined
  // Subset totals carry the prefix on the card ("SV122") but not in set data (122)
  const sameTotal = (read?: string) => Boolean(read && total && read.replace(/^[A-Z]+/, '') === total)
  let best = -Infinity
  for (const r of reads) {
    if (r.number === number) {
      best = Math.max(best, sameTotal(r.total) ? 1 : 0.6)
    } else if (sameTotal(r.total)) {
      // Right set, wrong number — likely a digit misread; weak evidence either way
      best = Math.max(best, 0.1)
    } else {
      best = Math.max(best, r.total ? -0.3 : 0)
    }
  }
  return best
}
