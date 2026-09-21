/**
 * Downloads every Pokémon TCG set symbol and builds a fingerprint database
 * for visual matching during card scans.
 *
 * Usage: node scripts/build-set-symbols.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const DATA_BASE = 'https://cdn.jsdelivr.net/gh/PokemonTCG/pokemon-tcg-data@master';
const HASH_SIZE = 16; // 16×16 → 256-bit aHash (hex string)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '../src/data/setSymbolDb.json');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

/** Average-hash: resize to HASH_SIZE² grayscale, bit = pixel > mean. */
async function fingerprintPng(buffer) {
  const { data, info } = await sharp(buffer)
    .grayscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;

  const bits = [];
  for (let i = 0; i < data.length; i++) bits.push(data[i] >= mean ? '1' : '0');

  // Pack to hex
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).join(''), 2).toString(16);
  }
  return { hash: hex, width: info.width, height: info.height };
}

async function downloadSymbol(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`symbol ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log('Loading set list…');
  const sets = await fetchJson(`${DATA_BASE}/sets/en.json`);
  console.log(`Found ${sets.length} sets`);

  const entries = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    const symbolUrl = set.images?.symbol;
    process.stdout.write(`[${i + 1}/${sets.length}] ${set.id} ${set.name}… `);
    if (!symbolUrl) {
      console.log('no symbol');
      fail++;
      continue;
    }
    try {
      const buf = await downloadSymbol(symbolUrl);
      const { hash } = await fingerprintPng(buf);
      entries.push({
        id: set.id,
        name: set.name,
        series: set.series ?? '',
        releaseDate: set.releaseDate ?? '',
        printedTotal: set.printedTotal ?? null,
        total: set.total ?? null,
        symbolUrl,
        hash,
      });
      ok++;
      console.log('ok');
    } catch (err) {
      fail++;
      console.log(`fail (${err instanceof Error ? err.message : err})`);
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        hashSize: HASH_SIZE,
        count: entries.length,
        sets: entries,
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote ${entries.length} symbols → ${outPath} (${fail} failed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
