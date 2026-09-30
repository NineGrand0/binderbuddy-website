/**
 * Buckets for reporting accuracy by the kind of card, plus tags for the cases that are hard
 * for any identifier (many printings of one Pokémon, lettered variants like XY67 / XY67a).
 */
import { isPromoSet, type CatalogueCard } from '../../src/lib/pokemonTcg.ts'

export type BenchCategory = 'vintage' | 'regular' | 'rule-box' | 'full-art' | 'promo'
export const CATEGORIES: readonly BenchCategory[] = ['vintage', 'regular', 'rule-box', 'full-art', 'promo']

export type BenchTag = 'many-printings' | 'lettered-variant' | 'same-name-in-set'

const FULL_ART_RARITY = /ultra|secret|rainbow|illustration|hyper|shiny|trainer gallery|full art|amazing|radiant/i
const RULE_BOX_NAME = /(\b|-)(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X|Prime|LEGEND)\b/
// Wizards of the Coast era ends with Skyridge (May 2003)
const VINTAGE_BEFORE = '2003/06/01'

export function categorize(card: CatalogueCard): BenchCategory {
  if (isPromoSet({ name: card.set, series: card.series })) return 'promo'
  if (card.releaseDate.replace(/-/g, '/') < VINTAGE_BEFORE) return 'vintage'
  if (card.rarity && FULL_ART_RARITY.test(card.rarity) && !/double rare/i.test(card.rarity)) return 'full-art'
  if (RULE_BOX_NAME.test(card.name)) return 'rule-box'
  return 'regular'
}

const baseNumber = (n: string) => n.replace(/[a-z]$/i, '').toLowerCase()
const baseName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Tag every card that has confusable siblings in the catalogue. */
export function tagCatalogue(cards: CatalogueCard[]): Map<string, BenchTag[]> {
  const byName = new Map<string, number>()
  const bySetNumber = new Map<string, number>()
  const bySetName = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const c of cards) {
    bump(byName, baseName(c.name))
    bump(bySetNumber, `${c.setId}|${baseNumber(c.number)}`)
    bump(bySetName, `${c.setId}|${baseName(c.name)}`)
  }
  const tags = new Map<string, BenchTag[]>()
  for (const c of cards) {
    const t: BenchTag[] = []
    if ((byName.get(baseName(c.name)) ?? 0) >= 8) t.push('many-printings')
    if ((bySetNumber.get(`${c.setId}|${baseNumber(c.number)}`) ?? 0) > 1) t.push('lettered-variant')
    if ((bySetName.get(`${c.setId}|${baseName(c.name)}`) ?? 0) > 1) t.push('same-name-in-set')
    tags.set(c.id, t)
  }
  return tags
}
