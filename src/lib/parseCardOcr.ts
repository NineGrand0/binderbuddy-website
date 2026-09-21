import type { Card } from '../types';
import { findSetsByCardCount, listAllPokemonSets } from './pokemonTcg';
import { findPokemonNamesPreferringTitle } from './pokemonNames';

export type ParsedCardDetails = {
  name?: string;
  set?: string;
  number?: string;
  rarity?: Card['rarity'];
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCollectorMatch(raw: string): number {
  const cleaned = raw.replace(/\s+/g, '');
  const parts = cleaned.split('/');
  if (parts.length === 2) {
    const [a, b] = parts;
    // Prefer real set sizes (3-digit denom like 168) over truncated OCR (16)
    let score = a.length + b.length;
    if (b.length >= 3) score += 20;
    if (a.length >= 3) score += 10;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) score += 5;
    return score;
  }
  return cleaned.length;
}

/** Collector numbers printed at the bottom of most TCG cards. */
export function extractCollectorNumber(text: string): string | undefined {
  const patterns = [
    /\b([A-Z]{0,3}\d{1,3})\s*\/\s*([A-Z]{0,3}\d{1,3})\b/gi,
    /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g,
    /\b((?:TG|GG|SV|RC|SM|XY)\d{1,3})\b/gi,
  ];

  const candidates: { value: string; score: number }[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[2]
        ? `${match[1]}/${match[2]}`.replace(/\s+/g, '')
        : match[1]?.toUpperCase();
      if (!value) continue;
      candidates.push({ value, score: scoreCollectorMatch(value) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
}

export function extractRarity(text: string): Card['rarity'] | undefined {
  const t = text.toLowerCase();

  if (
    /special\s*illustration\s*rare/.test(t) ||
    /hyper\s*rare/.test(t) ||
    /secret\s*rare/.test(t) ||
    /ace\s*spec/.test(t) ||
    /\bsecret\b/.test(t)
  ) {
    return 'secret';
  }
  if (
    /illustration\s*rare/.test(t) ||
    /ultra\s*rare/.test(t) ||
    /double\s*rare/.test(t) ||
    /\brare\s*ultra\b/.test(t) ||
    /\bamazing\s*rare\b/.test(t)
  ) {
    return 'ultra';
  }
  if (/\brare\s*holo\b/.test(t) || /\bholo(?:graphic)?\s*rare\b/.test(t) || /\brare\b/.test(t)) {
    return 'rare';
  }
  if (/\buncommon\b/.test(t)) return 'uncommon';
  if (/\bcommon\b/.test(t)) return 'common';

  // Heuristic from collector number: secret-style codes
  if (/\b(?:GG|TG)\d+/i.test(text)) return 'ultra';
  if (/\bSV\d{3,}\b/i.test(text)) return 'secret';

  return undefined;
}

export async function extractSetName(text: string): Promise<string | undefined> {
  const hay = normalize(text);
  if (hay.length < 4) return undefined;

  try {
    const sets = await listAllPokemonSets();
    const hits: { name: string; score: number }[] = [];

    for (const set of sets) {
      const setNorm = normalize(set.name);
      if (setNorm.length < 4) continue;
      if (!hay.includes(setNorm)) continue;
      // Longer set title matches score higher
      hits.push({ name: set.name, score: setNorm.length });
    }

    // Also try common short / OCR-friendly aliases
    const aliases: Record<string, string> = {
      'prismatic evolutions': 'Prismatic Evolutions',
      'paldea evolved': 'Paldea Evolved',
      'obsidian flames': 'Obsidian Flames',
      'temporal forces': 'Temporal Forces',
      'twilight masquerade': 'Twilight Masquerade',
      'stellar crown': 'Stellar Crown',
      'surging sparks': 'Surging Sparks',
      'journey together': 'Journey Together',
      'destined rivals': 'Destined Rivals',
      'scarlet violet': 'Scarlet & Violet',
      'base set': 'Base',
      'fossil': 'Fossil',
      'jungle': 'Jungle',
      'neo genesis': 'Neo Genesis',
      'ex ruby': 'EX Ruby & Sapphire',
      'crown zenith': 'Crown Zenith',
      'paldean fates': 'Paldean Fates',
      'shiny treasure': 'Shiny Treasure ex',
    };

    for (const [alias, setName] of Object.entries(aliases)) {
      if (hay.includes(alias)) {
        hits.push({ name: setName, score: alias.length + 2 });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits[0]?.name;
  } catch {
    return undefined;
  }
}

/**
 * Infer set from collector number denominator (044/185 → sets with 185 cards).
 * Returns a name only when the size uniquely identifies a set, or the best single candidate.
 */
export async function inferSetFromCollectorNumber(
  number?: string,
): Promise<string | undefined> {
  if (!number) return undefined;
  const m = number.match(/\/\s*(\d{1,3})\s*$/);
  if (!m) return undefined;
  const denom = Number(m[1]);
  if (!Number.isFinite(denom) || denom < 10) return undefined;

  const matches = await findSetsByCardCount(denom);
  if (matches.length === 0) return undefined;
  // Prefer printedTotal exact match over expanded `total` (secret rares inflate total)
  const printed = matches.filter((s) => s.printedTotal === denom);
  const pool = printed.length > 0 ? printed : matches;
  if (pool.length === 1) return pool[0].name;
  // Multiple sets share a size — don't guess from number alone
  return undefined;
}

export function collectorNumberDenom(number?: string): number | undefined {
  if (!number) return undefined;
  const m = number.match(/\/\s*(\d{1,3})\s*$/);
  if (!m) return undefined;
  const denom = Number(m[1]);
  return Number.isFinite(denom) && denom >= 10 ? denom : undefined;
}
/**
 * Infer rarity when the card has an “ex” / V / etc. suffix and OCR didn’t print a rarity word.
 */
export function inferRarityFromName(name: string, rarity?: Card['rarity']): Card['rarity'] {
  if (rarity) return rarity;
  const n = name.toLowerCase();
  if (/\bex\b/.test(n) || /\bvmax\b/.test(n) || /\bvstar\b/.test(n) || /\bgx\b/.test(n)) {
    return 'ultra';
  }
  if (/\bv\b/.test(n)) return 'ultra';
  return 'common';
}

/** Pull name / set / number / rarity from OCR text. */
export async function parseCardDetailsFromOcr(
  text: string,
  options?: { titleText?: string; footerText?: string },
): Promise<ParsedCardDetails> {
  const titleText = options?.titleText ?? text;
  const footerText = options?.footerText ?? text;
  const names = await findPokemonNamesPreferringTitle(titleText, text);
  const number = extractCollectorNumber(footerText) ?? extractCollectorNumber(text);
  const rarity = extractRarity(text);
  // Number size is more reliable than hoping the set name is printed as text
  const fromNumber = await inferSetFromCollectorNumber(number);
  const fromText = await extractSetName(footerText) ?? (await extractSetName(text));

  return {
    name: names[0],
    set: fromNumber ?? fromText,
    number,
    rarity,
  };
}
