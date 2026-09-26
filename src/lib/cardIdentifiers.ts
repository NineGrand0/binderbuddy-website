import type { Card } from '../types';

export type FieldConfidence = 'high' | 'medium' | 'low' | 'none';

export type CardNameSuffix = 'gx' | 'ex' | 'v' | 'vmax' | 'vstar';

/** Structured identifiers extracted from a card photo / OCR. */
export type CardIdentifiers = {
  /** Full display name including suffix when known (e.g. "Rayquaza GX"). */
  name?: string;
  /** Species / base without TCG suffix. */
  nameBase?: string;
  suffix?: CardNameSuffix | null;
  /** Display collector number as read (may keep leading zeros / slash). */
  number?: string;
  numberLeft?: string;
  numberRight?: string;
  /** Printed set code when OCR finds one (CES, SVP, …). */
  setCode?: string;
  /** Set title when confidently known (symbol or unambiguous text — not denom alone). */
  set?: string;
  setSource?: 'symbol' | 'text' | 'code' | null;
  /** Denominator from nnn/ddd — supporting set evidence only. */
  denom?: number;
  rarity?: Card['rarity'];
  confidence: {
    name: FieldConfidence;
    number: FieldConfidence;
    set: FieldConfidence;
  };
  uncertainties: string[];
};

const SUFFIX_RE = /(?:^|[\s-])(vmax|vstar|gx|ex|v)(?:\s|$)/i;

export function normalizeCardTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-_]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNameSuffix(name: string): {
  base: string;
  suffix: CardNameSuffix | null;
  display: string;
} {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  const norm = normalizeCardTitle(cleaned);
  const match = norm.match(/^(.*?)(?:\s+)(vmax|vstar|gx|ex|v)$/);
  if (match) {
    const suffix = match[2].toLowerCase() as CardNameSuffix;
    const base = match[1].trim();
    const displaySuffix =
      suffix === 'gx' ? 'GX' : suffix === 'ex' ? 'ex' : suffix.toUpperCase();
    return {
      base,
      suffix,
      display: `${cleaned.replace(new RegExp(`[\\s-]*${suffix}$`, 'i'), '').trim()} ${displaySuffix}`.replace(
        /\s+/g,
        ' ',
      ),
    };
  }
  // Glued: RayquazaGX / Rayquaza-GX already normalized to spaces above for match;
  // also handle original hyphen forms.
  const glued = cleaned.match(/^(.*?)[-\s]*(VMAX|VSTAR|GX|EX|ex|V)$/i);
  if (glued) {
    const raw = glued[2];
    const suffix = raw.toLowerCase() as CardNameSuffix;
    const base = normalizeCardTitle(glued[1]);
    const displaySuffix =
      suffix === 'gx' ? 'GX' : suffix === 'ex' ? 'ex' : suffix.toUpperCase();
    return { base, suffix, display: `${glued[1].trim()} ${displaySuffix}` };
  }
  return { base: norm, suffix: null, display: cleaned };
}

/**
 * Compare collector-number parts for equality while normalising formatting.
 * Preserves letter prefixes; compares digit runs without leading-zero sensitivity.
 */
export function normalizeCollectorPart(part: string): string {
  const raw = part.toLowerCase().replace(/\s+/g, '');
  const m = raw.match(/^([a-z]*)(\d+)([a-z]*)$/i);
  if (!m) return raw;
  const prefix = m[1];
  const digits = m[2].replace(/^0+(?=\d)/, '');
  const suffix = m[3];
  return `${prefix}${digits}${suffix}`;
}

export function parseCollectorNumber(value: string): {
  display: string;
  left: string;
  right?: string;
  denom?: number;
} | null {
  const cleaned = value.replace(/\s+/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    const left = parts[0];
    const right = parts[1];
    const denom = /^\d+$/.test(right) ? Number(right) : undefined;
    return {
      display: `${left}/${right}`,
      left,
      right,
      denom: denom != null && denom >= 10 ? denom : undefined,
    };
  }
  return { display: cleaned, left: cleaned };
}

export function collectorPartsMatch(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizeCollectorPart(a) === normalizeCollectorPart(b);
}

export function nameCompatibility(
  ocrName: string,
  catalogName: string,
): 'exact' | 'same-suffix' | 'base-only' | 'suffix-conflict' | 'no' {
  const ocr = parseNameSuffix(ocrName);
  const cat = parseNameSuffix(catalogName);
  if (!ocr.base || !cat.base) return 'no';

  const baseSame =
    ocr.base === cat.base ||
    cat.base.startsWith(`${ocr.base} `) ||
    ocr.base.startsWith(`${cat.base} `);

  if (!baseSame) {
    // Allow "pikachu" → "pikachu with grey felt hat"
    if (cat.base.startsWith(`${ocr.base} `) || normalizeCardTitle(catalogName).startsWith(`${ocr.base} `)) {
      if (ocr.suffix && cat.suffix && ocr.suffix !== cat.suffix) return 'suffix-conflict';
      if (ocr.suffix && !cat.suffix) return 'suffix-conflict';
      if (!ocr.suffix) return 'base-only';
      return 'same-suffix';
    }
    return 'no';
  }

  if (ocr.suffix && cat.suffix) {
    // A lone “V” is often a truncated VMAX/VSTAR logo — let the collector number decide
    if (ocr.suffix === 'v' && (cat.suffix === 'vmax' || cat.suffix === 'vstar')) return 'base-only';
    if (ocr.suffix !== cat.suffix) return 'suffix-conflict';
    return ocr.base === cat.base ? 'exact' : 'same-suffix';
  }
  if (ocr.suffix && !cat.suffix) return 'suffix-conflict';
  if (!ocr.suffix && cat.suffix) return 'base-only';
  return ocr.base === cat.base ? 'exact' : 'same-suffix';
}

/** Plausible OCR digit/letter swaps for a collector number string. */
export function collectorNumberAlternatives(raw: string): string[] {
  const base = raw.replace(/\s+/g, '');
  const alts = new Set<string>([base]);
  const swaps: Array<[RegExp, string]> = [
    [/0/g, 'O'],
    [/O/gi, '0'],
    [/1/g, 'l'],
    [/l/g, '1'],
    [/5/g, 'S'],
    [/S/gi, '5'],
    [/8/g, 'B'],
    [/B/gi, '8'],
  ];
  for (const [re, to] of swaps) {
    if (re.test(base)) alts.add(base.replace(re, to));
  }
  // Also digit-normalized display without changing structure
  const parsed = parseCollectorNumber(base);
  if (parsed) alts.add(parsed.display);
  return [...alts];
}

/**
 * Rewrite OCR noise around TCG suffixes before name/suffix matching.
 * The stylised VMAX logo (big V, small MAX) reads as “Vay”, “Vwax”, “Vaax”…,
 * and the “Evolves from Pikachu V” line must not count as the card's own suffix.
 */
export function normalizeSuffixOcr(text: string): string {
  let out = text;
  const evolvesFromV = /evolves\s+from\s+[a-z' .-]{2,24}?\s*v\b/i.test(out);
  out = out.replace(/evolves\s+from\s+([a-z' .-]{2,24}?)\s*v\b/gi, ' $1 ');
  // Glued or spaced VMAX lookalikes: VMAX, V MAX, Vwax, Vnax, Vaax, Vmx, Vay
  out = out.replace(
    /([a-z]{3,})?\s*\bv\s?(?:max|m[a4]x|[wn][a4]x|[a4][a4]x|mx|[a4][xy]|m[a4])\b/gi,
    (_m, base: string | undefined) => `${base ? `${base} ` : ''}VMAX`,
  );
  out = out.replace(/([a-z]{2,})v(?:max|[wn][a4]x|[a4][a4]x|[a4]y)\b/gi, '$1 VMAX');
  const hasSuffix = /\b(vmax|vstar|gx|ex)\b/i.test(out);
  if (!hasSuffix) {
    if (/\b(gigantamax|g\s?-?\s?max)\b/i.test(out) || /\bvmax\s+rule\b/i.test(text)) {
      out = `${out} VMAX`;
    } else if (evolvesFromV) {
      // Only VMAX / VSTAR cards evolve from a Pokémon V
      out = `${out} ${/\bv\s?star\b|\bstar\s+power\b/i.test(text) ? 'VSTAR' : 'VMAX'}`;
    }
  }
  return out;
}

export function detectSuffixInText(text: string): CardNameSuffix | null {
  const hay = normalizeCardTitle(normalizeSuffixOcr(text));
  if (/\bvmax\b/.test(hay) || /vmax\b/.test(hay)) return 'vmax';
  if (/\bvstar\b/.test(hay) || /vstar\b/.test(hay)) return 'vstar';
  if (/\bgx\b/.test(hay) || /gx\b/.test(hay)) return 'gx';
  if (/\bex\b/.test(hay) || /(?:^|\s)ex(?:\s|$)/.test(hay)) return 'ex';
  if (/\bv\b/.test(hay)) return 'v';
  if (SUFFIX_RE.test(text)) {
    const m = text.match(SUFFIX_RE);
    return (m?.[1]?.toLowerCase() as CardNameSuffix) ?? null;
  }
  return null;
}

/** Extract promo / set code tokens often printed near the collector number. */
export function extractSetCodeHint(text: string): string | undefined {
  const upper = text.toUpperCase();
  // Require code near digits so random OCR noise (e.g. “BRS”) does not invent a set
  const nearNumber = upper.match(
    /\b(MEP|CES|VIV|SVP|SWSH|CEL|PR-SV|PR-SW|PR-SM)\b(?=[\s\S]{0,16}\d)|\d[\s\S]{0,16}\b(MEP|CES|VIV|SVP|SWSH|CEL|PR-SV|PR-SW|PR-SM)\b/,
  );
  return nearNumber?.[1] ?? nearNumber?.[2];
}

/** Map common OCR lookalikes into digits for promo collector numbers. */
function repairOcrDigits(token: string): string | undefined {
  const map: Record<string, string> = {
    O: '0',
    o: '0',
    D: '0',
    Q: '0',
    Z: '3',
    z: '3',
    S: '5',
    s: '5',
    B: '8',
    b: '8',
    G: '6',
    I: '1',
    l: '1',
    F: '7',
    T: '7',
  };
  const digits = [...token]
    .map((c) => (/\d/.test(c) ? c : (map[c] ?? '')))
    .join('');
  if (/^\d{2,3}$/.test(digits)) return digits.padStart(3, '0');
  return undefined;
}

export function extractNumberHint(text: string): string | undefined {
  const repaired = text
    .replace(/[|\\]/g, '/')
    .replace(/[–—]/g, '-')
    .replace(/(\d)\s*[Il]\s*(\d{2,3})\b/g, '$1/$2')
    // OCR often appends a digit: 188/1858 → 188/185
    .replace(/\b(\d{1,3})\/(\d{3})\d\b/g, '$1/$2');

  const slash = repaired.match(/\b([A-Z]{0,3}\d{1,3})\s*\/\s*(\d{2,3})\b/i);
  if (slash) {
    const left = slash[1];
    const right = slash[2];
    // Reject year-like noise (e.g. 2026 misread as 20/26)
    if (!(Number(right) >= 1990 && Number(right) <= 2099 && left.length <= 2)) {
      return `${left}/${right}`.replace(/\s+/g, '');
    }
  }

  // Promo: MEP EN 037 / MEP en 039 — also glued junk 03748 → 037
  const promoNear = repaired.match(
    /\b(?:MEP|PROMO)\b[\s\S]{0,28}?(?:EN|ox|ov|on|tn|tw)?[\s\S]{0,10}?\b(0\d{2})\d{0,2}\b/i,
  );
  if (promoNear) return promoNear[1];

  const promoDigits = repaired.match(/\b(?:MEP|EN|PROMO)\s*(?:EN\s*)?(\d{1,3})\b/i);
  if (promoDigits) return promoDigits[1].padStart(3, '0');

  // Foil OCR: “MEP ox ZF” / “MEP en ZF” → 037
  const promoLetters = repaired.match(
    /\b(?:MEP|PROMO)\b[\s\S]{0,20}?(?:EN|ox|ov|on|tn|tw|en)?[\s\S]{0,8}?([O0ZDSBGFTl]{2,3})\b/i,
  );
  if (promoLetters) {
    const fixed = repairOcrDigits(promoLetters[1]);
    if (fixed && fixed !== '000') return fixed;
  }

  // Zero-padded promo only when near set/illus context — avoid ©2026 → 020 fragments
  const paddedNear = repaired.match(
    /(?:MEP|PROMO|Illus\.?|EN)\b[\s\S]{0,24}\b(0\d{2})\b|\b(0\d{2})\b[\s\S]{0,16}\b(?:MEP|PROMO)\b/i,
  );
  if (paddedNear) return paddedNear[1] ?? paddedNear[2];

  return undefined;
}

export function buildIdentifiers(input: {
  name?: string;
  number?: string;
  set?: string;
  setCode?: string;
  setSource?: CardIdentifiers['setSource'];
  rarity?: Card['rarity'];
  nameFromFuzzy?: boolean;
  numberFromFooter?: boolean;
}): CardIdentifiers {
  const uncertainties: string[] = [];
  let name = input.name?.trim();
  let nameBase: string | undefined;
  let suffix: CardNameSuffix | null | undefined;

  if (name) {
    const parsed = parseNameSuffix(name);
    nameBase = parsed.base;
    suffix = parsed.suffix;
    name = parsed.display;
  } else {
    uncertainties.push('No Pokémon name read from the title area.');
  }

  const numberParsed = input.number ? parseCollectorNumber(input.number) : null;
  if (!numberParsed) {
    uncertainties.push('Collector number not read — a closer photo of the bottom-left helps.');
  } else if (!numberParsed.right && /^\d{1,3}$/.test(numberParsed.left)) {
    uncertainties.push('Collector number missing the /set-size half; matching by left side only.');
  }

  // Denom is supporting evidence only — never a confirmed set by itself.
  const denom = numberParsed?.denom;

  let set = input.set?.trim() || undefined;
  let setSource = input.setSource ?? (set ? 'text' : null);
  if (!set && input.setCode) {
    setSource = 'code';
  }

  const confidence: CardIdentifiers['confidence'] = {
    name: !name ? 'none' : input.nameFromFuzzy ? 'low' : suffix ? 'high' : 'medium',
    number: !numberParsed
      ? 'none'
      : numberParsed.right
        ? input.numberFromFooter !== false
          ? 'high'
          : 'medium'
        : 'medium',
    set: !set
      ? input.setCode
        ? 'medium'
        : denom
          ? 'low'
          : 'none'
      : setSource === 'symbol'
        ? 'high'
        : setSource === 'code'
          ? 'medium'
          : 'medium',
  };

  if (confidence.name === 'low') {
    uncertainties.push('Name came from a fuzzy OCR match — confirm the printing.');
  }

  return {
    name,
    nameBase,
    suffix: suffix ?? null,
    number: numberParsed?.display,
    numberLeft: numberParsed?.left,
    numberRight: numberParsed?.right,
    setCode: input.setCode,
    set,
    setSource,
    denom,
    rarity: input.rarity,
    confidence,
    uncertainties,
  };
}
