/**
 * Validates tight printing match without hardcoding UI behaviour.
 * Cases: Rayquaza GX + 109/168 → Celestial Storm #109 (not every Rayquaza).
 *         Pikachu + 85 → Grey Felt Hat promo among Pikachu printings.
 *         Rayquaza GX with no number → needs collector number (not a Rayquaza dump).
 */
import { buildIdentifiers } from '../src/lib/cardIdentifiers.ts'
import { matchPokemonPrintings } from '../src/lib/pokemonTcg.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const rayIds = await matchPokemonPrintings(
  buildIdentifiers({
    name: 'Rayquaza GX',
    number: '109/168',
    numberFromFooter: true,
  }),
  { limit: 3 },
)
console.log(
  'Rayquaza GX 109/168 →',
  rayIds.candidates.map((c) => `${c.externalId} ${c.name} #${c.number} (${c.set})`).join(' | '),
)
assert(rayIds.mode === 'exact' || rayIds.mode === 'filtered', `expected filtered/exact, got ${rayIds.mode}`)
assert(rayIds.candidates.length >= 1 && rayIds.candidates.length <= 3, 'expected 1–3 candidates')
assert(
  rayIds.candidates.every((c) => /gx/i.test(c.name) && c.number.replace(/^0+/, '') === '109'),
  'all candidates must be GX #109',
)
assert(
  !rayIds.candidates.some((c) => !/gx/i.test(c.name)),
  'must not include non-GX Rayquaza',
)
assert(rayIds.candidates[0].externalId === 'sm7-109', `expected sm7-109 first, got ${rayIds.candidates[0].externalId}`)

const nameOnly = await matchPokemonPrintings(
  buildIdentifiers({ name: 'Rayquaza GX', numberFromFooter: false }),
  { limit: 3 },
)
console.log('Rayquaza GX (no number) →', nameOnly.mode, nameOnly.note.slice(0, 80))
assert(nameOnly.needsCollectorNumber, 'name-only must ask for collector number')
assert(nameOnly.candidates.length === 0, 'must not dump every Rayquaza when number missing')

const pika = await matchPokemonPrintings(
  buildIdentifiers({ name: 'Pikachu', number: '085', numberFromFooter: true }),
  { limit: 3 },
)
console.log(
  'Pikachu 085 →',
  pika.candidates.map((c) => `${c.externalId} ${c.name} #${c.number}`).join(' | '),
)
assert(pika.candidates[0]?.externalId === 'svp-85', `expected svp-85 first, got ${pika.candidates[0]?.externalId}`)
assert(pika.candidates.length <= 3, 'max 3 candidates')

console.log('Printing match validation passed.')
