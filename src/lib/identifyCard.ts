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
export async function identifyCroppedCard(imageDataUrl: string): Promise<CropIdentification> {
  const key = await hashDataUrl(imageDataUrl);
  const cached = identifyCache.get(key);
  if (cached) return cached;

  void warmPokemonCatalogue();

  const work = (async (): Promise<CropIdentification> => {
    try {
      const run = (async () => {
        const read = await readCardImage(imageDataUrl);
        const symbol = await matchSetSymbolFromImage(imageDataUrl).catch(() => null);
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

        const diagnostics = import.meta.env.DEV
          ? {
              identifiers,
              mode: matched.mode,
              ocrTitle: read.titleText,
              ocrFooter: read.bodyText,
              accepted: [...matched.candidates, ...matched.moreCandidates].map((c) => ({
                externalId: c.externalId,
                reason: c.reason,
                score: c.score,
              })),
              rejected: matched.rejects,
            }
          : undefined;

        if (matched.candidates.length === 0) {
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

        if (!details.name) details.name = matched.candidates[0].name;

        return {
          status: 'suggested' as const,
          details,
          candidates: matched.candidates,
          moreCandidates: matched.moreCandidates,
          suggested: matched.candidates[0],
          note: matched.note,
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
