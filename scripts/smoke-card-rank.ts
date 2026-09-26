const DATA_BASE = 'https://cdn.jsdelivr.net/gh/PokemonTCG/pokemon-tcg-data@master'

function normalizeText(value) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function normalizeNumber(value) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/^0+(\d)/, '$1')
}

const sets = await (await fetch(`${DATA_BASE}/sets/en.json`)).json()
const base = sets.find((set) => set.id === 'base1')
if (!base) throw new Error('Missing Base set.')
const cards = await (await fetch(`${DATA_BASE}/cards/en/base1.json`)).json()
const hits = cards
  .filter((card) => normalizeText(card.name).includes('charizard'))
  .map((card) => {
    let score = normalizeText(card.name) === 'charizard' ? 100 : 35
    const full = normalizeNumber(card.number)
    if (full === normalizeNumber('4') || full === normalizeNumber('4/102')) score += 80
    if (normalizeText(base.name) === 'base') score += 40
    return {
      externalId: card.id,
      name: card.name,
      set: base.name,
      number: card.number,
      imageUrl: card.images.large || card.images.small,
      score,
    }
  })
  .sort((a, b) => b.score - a.score)

if (hits.length < 1) throw new Error('Expected Charizard printings in Base.')
const top = hits[0]
if (top.externalId !== 'base1-4') throw new Error(`Expected base1-4, got ${top.externalId}`)
if (!top.imageUrl) throw new Error('Expected catalogue image.')

console.log(`Rank smoke passed: ${top.name} · ${top.set} · #${top.number} (${top.externalId}).`)
