import type { Card } from '../types';
import { findSetsByCardCount, listAllPokemonSets } from './pokemonTcg';
import { findPokemonNamesPreferringTitle, findPokemonNamesInText } from './pokemonNames';
import {
  buildIdentifiers,
  detectSuffixInText,
  parseNameSuffix,
  type CardIdentifiers,
} from './cardIdentifiers';

export type ParsedCardDetails = {
  name?: string;
  set?: string;
  number?: string;
  rarity?: Card['rarity'];
  /** Structured identifiers used for tight printing match. */
  identifiers?: CardIdentifiers;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fix common Tesseract mistakes in collector-number regions before matching. */
export function repairCollectorOcr(text: string): string {
  let repaired = text.replace(/[|\\]/g, '/').replace(/[–—−]/g, '-');

  // Structural fixes first — before single-char O/l swaps glue the number shut
  repaired = repaired
    .replace(/(\d{1,3})\s*[lI]\s*(\d{2,3})\b/g, '$1/$2')
    .replace(/(\d{1,3})\s*[oO]\s*(\d{2,3})\b/g, '$1/$2')
    .replace(/(\d{1,3})\s*\/\s*(\d{2,3})\b/g, '$1/$2')
    .replace(/(\d{1,3})\s*[.\-]\s*(\d{2,3})\b/g, '$1/$2')
    .replace(/\b(\d{1,3})\s+(\d{2,3})\b/g, (full, a, b) => {
      const denom = Number(b);
      return denom >= 10 && denom <= 999 ? `${a}/${b}` : full;
    });

  // Inside an already-slashed collector number, O/l are almost always 0/1
  repaired = repaired.replace(/\b([A-Za-z]{0,3}\d{0,3}[\dlIO]{1,3})\s*\/\s*([A-Za-z]{0,3}[\dlIO]{1,3})\b/g, (_full, a, b) => {
    const fix = (s: string) => s.replace(/[oO]/g, '0').replace(/[lI]/g, '1');
    return `${fix(a)}/${fix(b)}`;
  });

  return repaired;
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
  const repaired = repairCollectorOcr(text);
  const patterns = [
    /\b([A-Z]{0,3}\d{1,3})\s*\/\s*([A-Z]{0,3}\d{1,3})\b/gi,
    /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g,
    // Promo stamps: 085/SV-P, SVP 85, SWSH075
    /\b(\d{2,3})\s*\/\s*(?:SV-?P|SWSH|SM|XY|BW|SVP)\b/gi,
    /\b(?:SVP|SV-?P|SWSH|SM|XY|BW)\s*0*(\d{1,3})\b/gi,
    /\b((?:TG|GG|SV|RC|SM|XY|SWSH)\d{1,3})\b/gi,
  ];

  const candidates: { value: string; score: number }[] = [];
  for (const pattern of patterns) {
    for (const match of repaired.matchAll(pattern)) {
      let value: string | undefined;
      if (match[2]) {
        value = `${match[1]}/${match[2]}`.replace(/\s+/g, '');
      } else if (match[1]) {
        // Keep leading zeros for display; comparison normalises them later
        value = /^\d{1,3}$/.test(match[1]) ? match[1] : match[1].toUpperCase();
      }
      if (!value) continue;
      candidates.push({ value, score: scoreCollectorMatch(value) });
    }
  }

  // Promo / set-code + number: MEP EN 039, CES 177 (also glued 03748 → 037)
  if (candidates.length === 0) {
    for (const match of repaired.matchAll(
      /\b(?:MEP|CES|VIV|SVP|SWSH|CEL|PROMO)\b[\s\S]{0,24}?(?:EN\s*)?(0\d{2})\d{0,2}\b/gi,
    )) {
      candidates.push({ value: match[1], score: 14 });
    }
    for (const match of repaired.matchAll(
      /\b(?:MEP|CES|VIV|SVP|SWSH|CEL|EN)\s*(?:EN\s*)?(0?\d{2,3})\b/gi,
    )) {
      candidates.push({ value: match[1].padStart(3, '0'), score: 12 });
    }
  }

  // Footer-only fallback: zero-padded promo near Illus / set code — avoid ©2026 fragments
  if (candidates.length === 0) {
    for (const match of repaired.matchAll(
      /(?:MEP|PROMO|Illus\.?|EN)\b[\s\S]{0,24}\b(0\d{2})\b|\b(0\d{2})\b[\s\S]{0,16}\b(?:MEP|PROMO)\b/gi,
    )) {
      const value = match[1] ?? match[2];
      if (value) candidates.push({ value, score: 8 });
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
 * Denominator is supporting set evidence only — never treat a unique printedTotal
 * as a confirmed set identity (multiple eras can share sizes later).
 */
export async function setsMatchingDenom(number?: string): Promise<string[]> {
  const denom = collectorNumberDenom(number);
  if (!denom) return [];
  const matches = await findSetsByCardCount(denom);
  const printed = matches.filter((s) => s.printedTotal === denom);
  return (printed.length > 0 ? printed : matches).map((s) => s.name);
}

/** @deprecated Prefer setsMatchingDenom — denom is not a unique set id. */
export async function inferSetFromCollectorNumber(
  number?: string,
): Promise<string | undefined> {
  const names = await setsMatchingDenom(number);
  // Intentionally do not return a unique guess — callers use denom as support only.
  void names;
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

/** Printed set codes that sometimes appear near the collector number. */
export async function extractSetCode(text: string): Promise<string | undefined> {
  const hay = text.toUpperCase();
  try {
    const sets = await listAllPokemonSets();
    const codeHits: { code: string; score: number }[] = [];
    for (const set of sets) {
      const code = set.ptcgoCode?.toUpperCase();
      if (!code || code.length < 2) continue;
      const re = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(hay)) codeHits.push({ code, score: code.length + 10 });
    }
    for (const match of hay.matchAll(/\b([A-Z]{2,5})\b/g)) {
      const code = match[1];
      if (/^(HP|ATK|DMG|GX|EX|VMAX|VSTAR|BASIC|STAGE|EN|POKEMON)$/i.test(code)) continue;
      if (sets.some((s) => s.ptcgoCode?.toUpperCase() === code)) {
        codeHits.push({ code, score: code.length + 5 });
      }
    }
    codeHits.sort((a, b) => b.score - a.score);
    return codeHits[0]?.code;
  } catch {
    return undefined;
  }
}

/** Pull name / set / number / rarity from OCR text into structured identifiers. */
export async function parseCardDetailsFromOcr(
  text: string,
  options?: {
    titleText?: string;
    footerText?: string;
    setFromSymbol?: string;
    nameFromFuzzy?: boolean;
  },
): Promise<ParsedCardDetails> {
  const titleText = options?.titleText ?? text;
  const footerText = options?.footerText ?? text;

  const titleNames = await findPokemonNamesInText(titleText, { allowFuzzy: true });
  const preferred = await findPokemonNamesPreferringTitle(titleText, text);
  const nameRaw = preferred[0] ?? titleNames[0];
  const fuzzyOnly =
    Boolean(options?.nameFromFuzzy) ||
    (titleNames.length === 0 && Boolean(preferred[0]));

  // Ensure GX/ex/V suffixes from the title strip survive even if species list is bare
  let name = nameRaw;
  if (name) {
    // Only trust suffixes from the title band — body/footer text false-triggers “ex”
    let detected = detectSuffixInText(titleText);
    // These phrases only print on VMAX cards, so they're safe to trust outside the title band
    if ((!detected || detected === 'v') && /\bvmax\s+rule\b|\bgigantamax\b|\bg\s?-?\s?max\b/i.test(text)) {
      detected = 'vmax';
    }
    const parsed = parseNameSuffix(name);
    const upgradeV =
      parsed.suffix === 'v' && (detected === 'vmax' || detected === 'vstar');
    if (detected && (!parsed.suffix || upgradeV)) {
      const displaySuffix =
        detected === 'gx' ? 'GX' : detected === 'ex' ? 'ex' : detected.toUpperCase();
      name = `${parsed.display.replace(/\s+(GX|ex|VMAX|VSTAR|V)$/i, '').trim()} ${displaySuffix}`;
    }
  }

  const number = extractCollectorNumber(footerText) ?? extractCollectorNumber(text);
  const rarity = extractRarity(text);
  const setCode = await extractSetCode(footerText);

  // Set title: symbol > printed code lookup > OCR set name text.
  // Denominator is NOT used as a confirmed set (supporting evidence only in matcher).
  let set = options?.setFromSymbol?.trim() || undefined;
  let setSource: CardIdentifiers['setSource'] = set ? 'symbol' : null;
  if (!set && setCode) {
    try {
      const sets = await listAllPokemonSets();
      const byCode = sets.find((s) => s.ptcgoCode?.toUpperCase() === setCode.toUpperCase());
      if (byCode) {
        set = byCode.name;
        setSource = 'code';
      } else {
        setSource = 'code';
      }
    } catch {
      setSource = 'code';
    }
  }
  if (!set) {
    const fromText = (await extractSetName(footerText)) ?? (await extractSetName(text));
    if (fromText) {
      set = fromText;
      setSource = 'text';
    }
  }

  const identifiers = buildIdentifiers({
    name,
    number,
    set,
    setCode,
    setSource,
    rarity,
    nameFromFuzzy: fuzzyOnly,
    numberFromFooter: Boolean(extractCollectorNumber(footerText)),
  });

  return {
    name: identifiers.name,
    set: identifiers.set,
    number: identifiers.number,
    rarity: identifiers.rarity,
    identifiers,
  };
}
