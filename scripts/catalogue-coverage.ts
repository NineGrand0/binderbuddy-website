/**
 * Report catalogue coverage: how many sets/cards BinderBuddy sees after merging
 * PokemonTCG data + local supplements + TCGdex, and anything TCGdex lists that we still lack.
 *   npm run catalogue:coverage
 */
import { listAllPokemonSets, getCardsFromSet } from '../src/lib/pokemonTcg.ts'
import { listTcgdexSets } from '../src/lib/tcgdex.ts'

const sets = await listAllPokemonSets()
const tcgdex = await listTcgdexSets()

let cards = 0
const short: string[] = []
const empty: string[] = []
for (let i = 0; i < sets.length; i += 16) {
  const batch = sets.slice(i, i + 16)
  const counts = await Promise.all(
    batch.map((s) => getCardsFromSet(s.id, 5000).then((c) => c.length).catch(() => 0)),
  )
  batch.forEach((s, j) => {
    cards += counts[j]
    if (counts[j] === 0) empty.push(`${s.id} ${s.name}`)
    else if (s.total && counts[j] < s.total) short.push(`${s.id} ${s.name}: ${counts[j]}/${s.total}`)
  })
}

const tcgdexTotal = tcgdex.reduce((n, s) => n + (s.cardCount?.total ?? 0), 0)
console.log(`Catalogue: ${sets.length} sets · ${cards} cards`)
console.log(`TCGdex (physical sets): ${tcgdex.length} sets · ${tcgdexTotal} cards`)
console.log(`\nSets with fewer cards than their listed total (${short.length}):`)
console.log(short.join('\n') || '  none')
console.log(`\nSets with no card data (${empty.length}):`)
console.log(empty.join('\n') || '  none')
