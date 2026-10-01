import { readCardImage, resetCardReader } from './cardRead';
import { parseCardDetailsFromOcr, type ParsedCardDetails } from './parseCardOcr';
import { buildIdentifiers } from './cardIdentifiers';
import {
  matchPokemonPrintings,
  warmPokemonCatalogue,
  type MatchReject,
  type PokemonMatchCandidate,
} from './pokemonTcg';
import { matchSetSymbolFromImage } from './setSymbolMatch';
import { rankByLook } from './visualRank';

export type CardMatchStatus =
  | 'reading'
  | 'suggested'
  | 'accepted'
  | 'manual'
  | 'unidentified'
  | 'failed'
  | 'needs-number';

export type MatchDiagnostics = {
  identifiers: ReturnType<typeof buildIdentifiers>;
  mode: string;
  ocrTitle?: string;
  ocrFooter?: string;
  accepted: Array<{ externalId: string; reason?: string; score: number }>;
  rejected: MatchReject[];
};

export interface CropIdentification {
  status: CardMatchStatus;
  details: ParsedCardDetails;
  candidates: PokemonMatchCandidate[];
  moreCandidates: PokemonMatchCandidate[];
  suggested?: PokemonMatchCandidate;
  note: string;
  ocrText: string;
  needsCollectorNumber?: boolean;
  diagnostics?: MatchDiagnostics;
}

const identifyCache = new Map<string, Promise<CropIdentification>>();
// First run downloads the full catalogue for “show all printings”
const IDENTIFY_TIMEOUT_MS = 45_000;

async function hashDataUrl(dataUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(dataUrl.slice(0, 48_000));
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) hash = (hash * 31 + bytes[i]) | 0;
  return `fallback-${hash}-${dataUrl.length}`;
}

function emptyIdentification(note: string, status: CardMatchStatus = 'failed'): CropIdentification {
  return {
    status,
    details: {},
    candidates: [],
    moreCandidates: [],
    note,
    ocrText: '',
  };
}

/**
 * Identify a cropped card photo: read title + attack text → name/suffix/set/HP → every
 * catalogue printing that fits, best-evidence first. Collector numbers are not used.
 */
export async function identifyCroppedCard(
  imageDataUrl: string,
  /** 0…1 through reading the text (to 60%), the set symbol, the catalogue match and the art check. */
  onProgress?: (fraction: number) => void,
): Promise<CropIdentification> {
  const key = await hashDataUrl(imageDataUrl);
  const cached = identifyCache.get(key);
  if (cached) {
    onProgress?.(1);
    return cached;
  }

  void warmPokemonCatalogue();
  // Never report going backwards, whatever order the stages finish in
  let reported = 0;
  const progress = (fraction: number) => {
    if (fraction <= reported) return;
    reported = fraction;
    onProgress?.(fraction);
  };

  const work = (async (): Promise<CropIdentification> => {
    try {
      const run = (async () => {
        progress(0.02);
        const read = await readCardImage(imageDataUrl, (f) => progress(0.02 + 0.58 * f));
        const symbol = await matchSetSymbolFromImage(imageDataUrl).catch(() => null);
        progress(0.65);
        const setFromSymbol = symbol && symbol.confidence >= 0.55 ? symbol.name : undefined;

        const parsed = await parseCardDetailsFromOcr(read.fullText, {
          titleText: read.titleText,
          footerText: '',
          setFromSymbol,
        });

        const identifiers = buildIdentifiers({
          name: parsed.name,
          set: setFromSymbol,
          setSource: setFromSymbol ? 'symbol' : null,
          rarity: parsed.rarity,
          nameFromFuzzy: parsed.identifiers?.confidence.name === 'low',
        });
        const details: ParsedCardDetails = {
          name: identifiers.name,
          set: identifiers.set,
          rarity: parsed.rarity,
          identifiers,
        };

        const matched = await matchPokemonPrintings(identifiers, {
          limit: 3,
          moreLimit: 200,
          ocrText: read.fullText,
        });

        progress(0.8);
        // Text can't tell printings of the same card apart (same attacks, same HP); the art can
        const byText = [...matched.candidates, ...matched.moreCandidates];
        const byLook = await rankByLook(imageDataUrl, byText).catch(() => null);
        progress(1);
        const ranked = byLook ?? byText;
        const lookOnly = byLook !== null && byText.length === 0;

        const diagnostics = import.meta.env.DEV
          ? {
              identifiers,
              mode: byLook ? `${matched.mode}+look` : matched.mode,
              ocrTitle: read.titleText,
              ocrFooter: read.bodyText,
              accepted: ranked.map((c) => ({
                externalId: c.externalId,
                reason: c.reason,
                score: c.score,
              })),
              rejected: matched.rejects,
            }
          : undefined;

        if (ranked.length === 0) {
          return {
            status: 'failed' as const,
            details,
            candidates: [],
            moreCandidates: [],
            note: identifiers.name ? matched.note : read.notes[0] || matched.note,
            ocrText: read.fullText,
            diagnostics,
          };
        }

        if (!details.name) details.name = ranked[0].name;

        return {
          status: 'suggested' as const,
          details,
          candidates: ranked.slice(0, 3),
          moreCandidates: ranked.slice(3),
          suggested: ranked[0],
          note: lookOnly
            ? 'Couldn’t read the card’s text — these printings look most like your photo. Pick yours.'
            : byLook
              ? `${ranked.length} printings found — ranked by the card’s text and how closely the art matches your photo. Check the top pick.`
              : matched.note,
          ocrText: read.fullText,
          diagnostics,
        };
      })();

      return await Promise.race([
        run,
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            void resetCardReader();
            reject(new Error('Card reading timed out. Try a sharper crop, or edit details manually.'));
          }, IDENTIFY_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      identifyCache.delete(key);
      void resetCardReader();
      return emptyIdentification(
        err instanceof Error ? err.message : 'Could not identify this card.',
        'failed',
      );
    }
  })();

  identifyCache.set(key, work);
  try {
    return await work;
  } catch (err) {
    identifyCache.delete(key);
    throw err;
  }
}

export function clearIdentifyCache() {
  identifyCache.clear();
}

/** @deprecated use resetCardReader */
export async function resetOcrWorker() {
  return resetCardReader();
}
