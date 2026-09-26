/**
 * Validates number-free detection against the five sample photos.
 * Mirrors the browser reader: title bands + attack/ability bands, no footer / collector number.
 * A sample passes when the right printing is somewhere in the returned list.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js'
import sharp from 'sharp'
import path from 'node:path'
import { buildIdentifiers } from '../src/lib/cardIdentifiers.ts'
import { matchPokemonPrintings } from '../src/lib/pokemonTcg.ts'
import { parseCardDetailsFromOcr } from '../src/lib/parseCardOcr.ts'

const ASSETS =
  'C:/Users/firmi/.cursor/projects/c-Users-firmi-binderbuddy-website/assets'

type Sample = {
  label: string
  file: string
  expectIds?: string[]
  expectName: RegExp
}

const SAMPLES: Sample[] = [
  {
    label: 'Pikachu VMAX',
    expectIds: ['swsh4-188'],
    expectName: /pikachu vmax/i,
    file: 'c__Users_firmi_AppData_Roaming_Cursor_User_workspaceStorage_eb5733513384bd47c1a7397ae3b4ac3c_images_WhatsApp_Image_2026-09-11_at_13.16.05__1_-340c6a40-7b42-4423-8c90-cac5d2ee2827.jpg',
  },
  {
    label: 'Rayquaza GX',
    expectIds: ['sm7-177', 'sm7-177a'],
    expectName: /rayquaza/i,
    file: 'c__Users_firmi_AppData_Roaming_Cursor_User_workspaceStorage_eb5733513384bd47c1a7397ae3b4ac3c_images_WhatsApp_Image_2026-09-11_at_13.16.05__4_-4288fc4d-8e3b-4160-b0d0-381eb21f25b5.jpg',
  },
  {
    label: 'Squirtle MEP',
    expectIds: ['mep-39'],
    expectName: /squirtle/i,
    file: 'c__Users_firmi_AppData_Roaming_Cursor_User_workspaceStorage_eb5733513384bd47c1a7397ae3b4ac3c_images_WhatsApp_Image_2026-09-11_at_13.16.06-274f062a-1e00-49c0-9fbb-9d522b866b64.jpg',
  },
  {
    label: 'Charmander MEP',
    expectIds: ['mep-38'],
    expectName: /charmander/i,
    file: 'c__Users_firmi_AppData_Roaming_Cursor_User_workspaceStorage_eb5733513384bd47c1a7397ae3b4ac3c_images_WhatsApp_Image_2026-09-11_at_13.16.06__1_-aa410c71-358f-4cb5-9f51-1892d4a4c412.jpg',
  },
  {
    label: 'Bulbasaur MEP',
    expectIds: ['mep-37'],
    expectName: /bulbasaur/i,
    file: 'c__Users_firmi_AppData_Roaming_Cursor_User_workspaceStorage_eb5733513384bd47c1a7397ae3b4ac3c_images_WhatsApp_Image_2026-09-11_at_13.16.06__2_-4020baa0-ada5-4b28-9736-80d36db46475.jpg',
  },
]

type Region = { x: number; y: number; w: number; h: number }

async function ocr(worker: Worker, file: string, region: Region, prep: string, psm: PSM) {
  const full = path.join(ASSETS, file)
  const meta = await sharp(full).metadata()
  const left = Math.floor(region.x * meta.width!)
  const top = Math.floor(region.y * meta.height!)
  const width = Math.floor(region.w * meta.width!)
  const height = Math.floor(region.h * meta.height!)
  let s = sharp(full).extract({ left, top, width, height }).resize({ width: 1200 })
  if (prep === 'contrast') s = s.greyscale().normalize().sharpen()
  if (prep === 'invert') s = s.greyscale().normalize().negate().sharpen()
  const buf = await s.png().toBuffer()
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_char_whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/ &'-.@",
  })
  const {
    data: { text, confidence },
  } = await worker.recognize(buf)
  return { text: text.replace(/\s+/g, ' ').trim(), confidence }
}

const worker = await createWorker('eng')
let passed = 0
let failed = 0

for (const sample of SAMPLES) {
  console.log('\n##', sample.label)
  const titleParts: Array<{ text: string; confidence: number }> = []
  for (const region of [
    { x: 0.05, y: 0.02, w: 0.78, h: 0.14 },
    { x: 0.06, y: 0.04, w: 0.7, h: 0.12 },
  ]) {
    for (const prep of ['raw', 'contrast', 'invert']) {
      titleParts.push(await ocr(worker, sample.file, region, prep, PSM.SINGLE_LINE))
      titleParts.push(await ocr(worker, sample.file, region, prep, PSM.SPARSE_TEXT))
    }
  }
  const bodyParts: string[] = []
  for (const region of [
    { x: 0.04, y: 0.46, w: 0.92, h: 0.22 },
    { x: 0.04, y: 0.62, w: 0.92, h: 0.22 },
  ]) {
    for (const prep of ['raw', 'invert']) {
      bodyParts.push((await ocr(worker, sample.file, region, prep, PSM.SPARSE_TEXT)).text)
    }
  }

  const titleText = titleParts
    .filter((p) => p.text.length > 2)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((p) => p.text)
    .join('\n')
  const fullText = [titleText, ...bodyParts.filter(Boolean)].join('\n')

  const parsed = await parseCardDetailsFromOcr(fullText, { titleText, footerText: '' })
  const identifiers = buildIdentifiers({
    name: parsed.name,
    nameFromFuzzy: parsed.identifiers?.confidence.name === 'low',
  })
  const matched = await matchPokemonPrintings(identifiers, {
    limit: 3,
    moreLimit: 200,
    ocrText: fullText,
  })
  const all = [...matched.candidates, ...matched.moreCandidates]
  console.log('Name', identifiers.name ?? '(none)', '| results', all.length, '| mode', matched.mode)
  console.log(
    'Top',
    matched.candidates.map((c) => `${c.externalId} ${c.name} [${c.reason}]`).join(' | ') || '(none)',
  )
  console.log('Note', matched.note.slice(0, 140))

  let ok: boolean
  if (sample.expectIds) {
    const rank = all.findIndex((c) => sample.expectIds!.includes(c.externalId))
    console.log('Expected printing rank', rank >= 0 ? rank + 1 : 'missing', 'of', all.length)
    ok = rank >= 0
  } else {
    ok = sample.expectName.test(identifiers.name ?? '')
  }
  console.log(ok ? 'PASS' : 'FAIL')
  if (ok) passed++
  else failed++
}

await worker.terminate()
console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed ? 1 : 0)
