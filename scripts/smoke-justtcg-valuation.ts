import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveJustTcgCard, searchJustTcgCards } from '../server/justtcg.ts'

function apiKeyFromFile(): string | undefined {
  try {
    const text = readFileSync(resolve('.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^JUSTTCG_API_KEY=(.*)$/)
      if (!match) continue
      return match[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    return undefined
  }
  return undefined
}

const apiKey = process.env.JUSTTCG_API_KEY || apiKeyFromFile()
if (!apiKey) {
  console.error('Set JUSTTCG_API_KEY in .env.local before running this smoke test.')
  process.exit(1)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

console.log('JustTCG valuation smoke — exact match only\n')

const sample = await searchJustTcgCards({
  apiKey,
  name: 'Charizard',
  number: '4',
  condition: 'NM',
})
assert(sample.length > 0, 'Expected JustTCG search hits for Charizard #4.')

const twoPrintings = sample.find((card) => (card.printings?.length ?? 0) >= 2)
const onePrinting = sample.find((card) => card.set_name === 'Base Set') ?? sample[0]
assert(twoPrintings, 'Expected at least one Charizard #4 with two printings for the smoke test.')

const [printingLabelA, printingLabelB] = twoPrintings.printings
const number = String(twoPrintings.number ?? '4').split('/')[0]

console.log(
  `Two-printings card: ${twoPrintings.set_name} #${twoPrintings.number} → ${printingLabelA} vs ${printingLabelB}`,
)

const printingA = await resolveJustTcgCard({
  apiKey,
  name: 'Charizard',
  set: String(twoPrintings.set_name),
  number,
  condition: 'NM',
  printing: printingLabelA,
})
const printingB = await resolveJustTcgCard({
  apiKey,
  name: 'Charizard',
  set: String(twoPrintings.set_name),
  number,
  condition: 'NM',
  printing: printingLabelB,
})

console.log('Printing A:', printingA.status)
console.log('Printing B:', printingB.status)
assert(printingA.status === 'priced', `Expected printing A priced, got ${printingA.status}`)
assert(printingB.status === 'priced', `Expected printing B priced, got ${printingB.status}`)
assert(
  printingA.justtcgVariantId !== printingB.justtcgVariantId,
  'Different printings must not share a JustTCG variant id.',
)
console.log('OK — two printings mapped to distinct variants.\n')

const wrongPrinting = await resolveJustTcgCard({
  apiKey,
  name: 'Charizard',
  set: String(onePrinting.set_name ?? 'Base Set'),
  number: String(onePrinting.number ?? '4').split('/')[0],
  condition: 'NM',
  printing: 'Definitely-Not-A-Printing',
})
assert(wrongPrinting.status === 'unavailable', 'Wrong printing must not fall back to another variant.')
console.log('OK — wrong printing stays unavailable.\n')

const nm = await resolveJustTcgCard({
  apiKey,
  name: 'Charizard',
  set: String(twoPrintings.set_name),
  number,
  condition: 'NM',
  printing: printingLabelA,
})
const lp = await resolveJustTcgCard({
  apiKey,
  name: 'Charizard',
  set: String(twoPrintings.set_name),
  number,
  condition: 'LP',
  printing: printingLabelA,
})

console.log('Condition NM:', nm.status)
console.log('Condition LP:', lp.status)
assert(nm.status === 'priced', 'Expected NM priced')
assert(lp.status === 'priced', 'Expected LP priced')
assert(nm.justtcgVariantId !== lp.justtcgVariantId, 'NM and LP must use different variant ids.')
console.log('OK — NM and LP are distinct variants.\n')

const unmatched = await resolveJustTcgCard({
  apiKey,
  name: 'Definitely Not A Real Card XYZ',
  set: 'Fake Set That Does Not Exist',
  number: '9999z',
  condition: 'NM',
})

assert(unmatched.status === 'unavailable', 'Unmatched card must return unavailable, not a substitute.')
console.log('Unmatched:', unmatched.status, '—', unmatched.reason)
console.log('\nSmoke finished.')
