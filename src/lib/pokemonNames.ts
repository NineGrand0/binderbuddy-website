import { normalizeSuffixOcr } from './cardIdentifiers';

/** Cached national-dex style names for OCR reverse lookup. */
let namesPromise: Promise<string[]> | null = null;

const FALLBACK_NAMES = [
  'Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Charmeleon', 'Charizard',
  'Squirtle', 'Wartortle', 'Blastoise', 'Caterpie', 'Metapod', 'Butterfree',
  'Weedle', 'Kakuna', 'Beedrill', 'Pidgey', 'Pidgeotto', 'Pidgeot', 'Rattata',
  'Raticate', 'Spearow', 'Fearow', 'Ekans', 'Arbok', 'Pikachu', 'Raichu',
  'Sandshrew', 'Sandslash', 'Nidoran', 'Nidorina', 'Nidoqueen', 'Nidorino',
  'Nidoking', 'Clefairy', 'Clefable', 'Vulpix', 'Ninetales', 'Jigglypuff',
  'Wigglytuff', 'Zubat', 'Golbat', 'Oddish', 'Gloom', 'Vileplume', 'Paras',
  'Parasect', 'Venonat', 'Venomoth', 'Diglett', 'Dugtrio', 'Meowth', 'Persian',
  'Psyduck', 'Golduck', 'Mankey', 'Primeape', 'Growlithe', 'Arcanine', 'Poliwag',
  'Poliwhirl', 'Poliwrath', 'Abra', 'Kadabra', 'Alakazam', 'Machop', 'Machoke',
  'Machamp', 'Bellsprout', 'Weepinbell', 'Victreebel', 'Tentacool', 'Tentacruel',
  'Geodude', 'Graveler', 'Golem', 'Ponyta', 'Rapidash', 'Slowpoke', 'Slowbro',
  'Magnemite', 'Magneton', 'Farfetchd', "Farfetch'd", 'Doduo', 'Dodrio', 'Seel',
  'Dewgong', 'Grimer', 'Muk', 'Shellder', 'Cloyster', 'Gastly', 'Haunter',
  'Gengar', 'Onix', 'Drowzee', 'Hypno', 'Krabby', 'Kingler', 'Voltorb',
  'Electrode', 'Exeggcute', 'Exeggutor', 'Cubone', 'Marowak', 'Hitmonlee',
  'Hitmonchan', 'Lickitung', 'Koffing', 'Weezing', 'Rhyhorn', 'Rhydon',
  'Chansey', 'Tangela', 'Kangaskhan', 'Horsea', 'Seadra', 'Goldeen', 'Seaking',
  'Staryu', 'Starmie', 'Mr Mime', 'Scyther', 'Jynx', 'Electabuzz', 'Magmar',
  'Pinsir', 'Tauros', 'Magikarp', 'Gyarados', 'Lapras', 'Ditto', 'Eevee',
  'Vaporeon', 'Jolteon', 'Flareon', 'Porygon', 'Omanyte', 'Omastar', 'Kabuto',
  'Kabutops', 'Aerodactyl', 'Snorlax', 'Articuno', 'Zapdos', 'Moltres',
  'Dratini', 'Dragonair', 'Dragonite', 'Mewtwo', 'Mew', 'Chikorita', 'Bayleef',
  'Meganium', 'Cyndaquil', 'Quilava', 'Typhlosion', 'Totodile', 'Croconaw',
  'Feraligatr', 'Sentret', 'Furret', 'Hoothoot', 'Noctowl', 'Ledyba', 'Ledian',
  'Spinarak', 'Ariados', 'Crobat', 'Chinchou', 'Lanturn', 'Pichu', 'Cleffa',
  'Igglybuff', 'Togepi', 'Togetic', 'Natu', 'Xatu', 'Mareep', 'Flaaffy',
  'Ampharos', 'Bellossom', 'Marill', 'Azumarill', 'Sudowoodo', 'Politoed',
  'Hoppip', 'Skiploom', 'Jumpluff', 'Aipom', 'Sunkern', 'Sunflora', 'Yanma',
  'Wooper', 'Quagsire', 'Espeon', 'Umbreon', 'Murkrow', 'Slowking', 'Misdreavus',
  'Unown', 'Wobbuffet', 'Girafarig', 'Pineco', 'Forretress', 'Dunsparce',
  'Gligar', 'Steelix', 'Snubbull', 'Granbull', 'Qwilfish', 'Scizor', 'Shuckle',
  'Heracross', 'Sneasel', 'Teddiursa', 'Ursaring', 'Slugma', 'Magcargo',
  'Swinub', 'Piloswine', 'Corsola', 'Remoraid', 'Octillery', 'Delibird',
  'Mantine', 'Skarmory', 'Houndour', 'Houndoom', 'Kingdra', 'Phanpy',
  'Donphan', 'Porygon2', 'Stantler', 'Smeargle', 'Tyrogue', 'Hitmontop',
  'Smoochum', 'Elekid', 'Magby', 'Miltank', 'Blissey', 'Raikou', 'Entei',
  'Suicune', 'Larvitar', 'Pupitar', 'Tyranitar', 'Lugia', 'Ho-Oh', 'Celebi',
  'Treecko', 'Grovyle', 'Sceptile', 'Torchic', 'Combusken', 'Blaziken',
  'Mudkip', 'Marshtomp', 'Swampert', 'Ralts', 'Kirlia', 'Gardevoir', 'Gallade',
  'Slaking', 'Aggron', 'Flygon', 'Absol', 'Wailord', 'Milotic', 'Kecleon',
  'Shuppet', 'Banette', 'Duskull', 'Dusclops', 'Dusknoir', 'Tropius', 'Chimecho',
  'Snorunt', 'Glalie', 'Froslass', 'Spheal', 'Sealeo', 'Walrein', 'Relicanth',
  'Luvdisc', 'Bagon', 'Shelgon', 'Salamence', 'Beldum', 'Metang', 'Metagross',
  'Regirock', 'Regice', 'Registeel', 'Latias', 'Latios', 'Kyogre', 'Groudon',
  'Rayquaza', 'Jirachi', 'Deoxys', 'Turtwig', 'Grotle', 'Torterra', 'Chimchar',
  'Monferno', 'Infernape', 'Piplup', 'Prinplup', 'Empoleon', 'Starly', 'Staravia',
  'Staraptor', 'Bidoof', 'Bibarel', 'Shinx', 'Luxio', 'Luxray', 'Budew',
  'Roserade', 'Cranidos', 'Rampardos', 'Shieldon', 'Bastiodon', 'Combee',
  'Vespiquen', 'Pachirisu', 'Buizel', 'Floatzel', 'Cherubi', 'Cherrim',
  'Shellos', 'Gastrodon', 'Ambipom', 'Drifloon', 'Drifblim', 'Buneary',
  'Lopunny', 'Mismagius', 'Honchkrow', 'Glameow', 'Purugly', 'Chingling',
  'Stunky', 'Skuntank', 'Bronzor', 'Bronzong', 'Bonsly', 'Mime Jr', 'Happiny',
  'Chatot', 'Spiritomb', 'Gible', 'Gabite', 'Garchomp', 'Munchlax', 'Riolu',
  'Lucario', 'Hippopotas', 'Hippowdon', 'Skorupi', 'Drapion', 'Croagunk',
  'Toxicroak', 'Carnivine', 'Finneon', 'Lumineon', 'Mantyke', 'Snover',
  'Abomasnow', 'Weavile', 'Magnezone', 'Lickilicky', 'Rhyperior', 'Tangrowth',
  'Electivire', 'Magmortar', 'Togekiss', 'Yanmega', 'Leafeon', 'Glaceon',
  'Gliscor', 'Mamoswine', 'Porygon-Z', 'Probopass', 'Froslass', 'Rotom',
  'Uxie', 'Mesprit', 'Azelf', 'Dialga', 'Palkia', 'Heatran', 'Regigigas',
  'Giratina', 'Cresselia', 'Phione', 'Manaphy', 'Darkrai', 'Shaymin', 'Arceus',
  'Victini', 'Snivy', 'Servine', 'Serperior', 'Tepig', 'Pignite', 'Emboar',
  'Oshawott', 'Dewott', 'Samurott', 'Zorua', 'Zoroark', 'Minccino', 'Cinccino',
  'Gothita', 'Gothorita', 'Gothitelle', 'Solosis', 'Duosion', 'Reuniclus',
  'Ducklett', 'Swanna', 'Vanillite', 'Vanillish', 'Vanilluxe', 'Deerling',
  'Sawsbuck', 'Emolga', 'Karrablast', 'Escavalier', 'Foongus', 'Amoonguss',
  'Frillish', 'Jellicent', 'Alomomola', 'Joltik', 'Galvantula', 'Ferroseed',
  'Ferrothorn', 'Klink', 'Klang', 'Klinklang', 'Tynamo', 'Eelektrik',
  'Eelektross', 'Elgyem', 'Beheeyem', 'Litwick', 'Lampent', 'Chandelure',
  'Axew', 'Fraxure', 'Haxorus', 'Cubchoo', 'Beartic', 'Cryogonal', 'Shelmet',
  'Accelgor', 'Stunfisk', 'Mienfoo', 'Mienshao', 'Druddigon', 'Golett',
  'Golurk', 'Pawniard', 'Bisharp', 'Bouffalant', 'Rufflet', 'Braviary',
  'Vullaby', 'Mandibuzz', 'Heatmor', 'Durant', 'Deino', 'Zweilous',
  'Hydreigon', 'Larvesta', 'Volcarona', 'Cobalion', 'Terrakion', 'Virizion',
  'Tornadus', 'Thundurus', 'Reshiram', 'Zekrom', 'Landorus', 'Kyurem',
  'Keldeo', 'Meloetta', 'Genesect', 'Chespin', 'Quilladin', 'Chesnaught',
  'Fennekin', 'Braixen', 'Delphox', 'Froakie', 'Frogadier', 'Greninja',
  'Fletchling', 'Fletchinder', 'Talonflame', 'Scatterbug', 'Spewpa', 'Vivillon',
  'Litleo', 'Pyroar', 'Flabebe', 'Floette', 'Florges', 'Skiddo', 'Gogoat',
  'Pancham', 'Pangoro', 'Furfrou', 'Espurr', 'Meowstic', 'Honedge', 'Doublade',
  'Aegislash', 'Spritzee', 'Aromatisse', 'Swirlix', 'Slurpuff', 'Inkay',
  'Malamar', 'Binacle', 'Barbaracle', 'Skrelp', 'Dragalge', 'Clauncher',
  'Clawitzer', 'Helioptile', 'Heliolisk', 'Tyrunt', 'Tyrantrum', 'Amaura',
  'Aurorus', 'Sylveon', 'Hawlucha', 'Dedenne', 'Carbink', 'Goomy', 'Sliggoo',
  'Goodra', 'Klefki', 'Phantump', 'Trevenant', 'Pumpkaboo', 'Gourgeist',
  'Bergmite', 'Avalugg', 'Noibat', 'Noivern', 'Xerneas', 'Yveltal', 'Zygarde',
  'Diancie', 'Hoopa', 'Volcanion', 'Rowlet', 'Dartrix', 'Decidueye', 'Litten',
  'Torracat', 'Incineroar', 'Popplio', 'Brionne', 'Primarina', 'Pikipek',
  'Trumbeak', 'Toucannon', 'Yungoos', 'Gumshoos', 'Grubbin', 'Charjabug',
  'Vikavolt', 'Crabrawler', 'Crabominable', 'Oricorio', 'Cutiefly', 'Ribombee',
  'Rockruff', 'Lycanroc', 'Wishiwashi', 'Mareanie', 'Toxapex', 'Mudbray',
  'Mudsdale', 'Dewpider', 'Araquanid', 'Fomantis', 'Lurantis', 'Morelull',
  'Shiinotic', 'Salandit', 'Salazzle', 'Stufful', 'Bewear', 'Bounsweet',
  'Steenee', 'Tsareena', 'Comfey', 'Oranguru', 'Passimian', 'Wimpod',
  'Golisopod', 'Sandygast', 'Palossand', 'Pyukumuku', 'Type Null', 'Silvally',
  'Minior', 'Komala', 'Turtonator', 'Togedemaru', 'Mimikyu', 'Bruxish',
  'Drampa', 'Dhelmise', 'Jangmo-o', 'Hakamo-o', 'Kommo-o', 'Tapu Koko',
  'Tapu Lele', 'Tapu Bulu', 'Tapu Fini', 'Cosmog', 'Cosmoem', 'Solgaleo',
  'Lunala', 'Nihilego', 'Buzzwole', 'Pheromosa', 'Xurkitree', 'Celesteela',
  'Kartana', 'Guzzlord', 'Necrozma', 'Magearna', 'Marshadow', 'Poipole',
  'Naganadel', 'Stakataka', 'Blacephalon', 'Zeraora', 'Meltan', 'Melmetal',
  'Grookey', 'Thwackey', 'Rillaboom', 'Scorbunny', 'Raboot', 'Cinderace',
  'Sobble', 'Drizzile', 'Inteleon', 'Skwovet', 'Greedent', 'Rookidee',
  'Corvisquire', 'Corviknight', 'Blipbug', 'Dottler', 'Orbeetle', 'Nickit',
  'Thievul', 'Gossifleur', 'Eldegoss', 'Wooloo', 'Dubwool', 'Chewtle',
  'Drednaw', 'Yamper', 'Boltund', 'Rolycoly', 'Carkol', 'Coalossal', 'Applin',
  'Flapple', 'Appletun', 'Silicobra', 'Sandaconda', 'Cramorant', 'Arrokuda',
  'Barraskewda', 'Toxel', 'Toxtricity', 'Sizzlipede', 'Centiskorch', 'Clobbopus',
  'Grapploct', 'Sinistea', 'Polteageist', 'Hatenna', 'Hattrem', 'Hatterene',
  'Impidimp', 'Morgrem', 'Grimmsnarl', 'Obstagoon', 'Perrserker', 'Cursola',
  'Sirfetchd', "Sirfetch'd", 'Mr Rime', 'Runerigus', 'Milcery', 'Alcremie',
  'Falinks', 'Pincurchin', 'Snom', 'Frosmoth', 'Stonjourner', 'Eiscue',
  'Indeedee', 'Morpeko', 'Cufant', 'Copperajah', 'Dracozolt', 'Arctozolt',
  'Dracovish', 'Arctovish', 'Duraludon', 'Dreepy', 'Drakloak', 'Dragapult',
  'Zacian', 'Zamazenta', 'Eternatus', 'Kubfu', 'Urshifu', 'Zarude', 'Regieleki',
  'Regidrago', 'Glastrier', 'Spectrier', 'Calyrex', 'Wyrdeer', 'Kleavor',
  'Ursaluna', 'Basculegion', 'Sneasler', 'Overqwil', 'Enamorus', 'Sprigatito',
  'Floragato', 'Meowscarada', 'Fuecoco', 'Crocalor', 'Skeledirge', 'Quaxly',
  'Quaxwell', 'Quaquaval', 'Lechonk', 'Oinkologne', 'Tarountula', 'Spidops',
  'Nymble', 'Lokix', 'Pawmi', 'Pawmo', 'Pawmot', 'Tandemaus', 'Maushold',
  'Fidough', 'Dachsbun', 'Smoliv', 'Dolliv', 'Arboliva', 'Squawkabilly',
  'Nacli', 'Naclstack', 'Garganacl', 'Charcadet', 'Armarouge', 'Ceruledge',
  'Tadbulb', 'Bellibolt', 'Wattrel', 'Kilowattrel', 'Maschiff', 'Mabosstiff',
  'Shroodle', 'Grafaiai', 'Bramblin', 'Brambleghast', 'Toedscool', 'Toedscruel',
  'Klawf', 'Capsakid', 'Scovillain', 'Rellor', 'Rabsca', 'Flittle', 'Espathra',
  'Tinkatink', 'Tinkatuff', 'Tinkaton', 'Wiglett', 'Wugtrio', 'Bombirdier',
  'Finizen', 'Palafin', 'Varoom', 'Revavroom', 'Cyclizar', 'Orthworm',
  'Glimmet', 'Glimmora', 'Greavard', 'Houndstone', 'Flamigo', 'Cetoddle',
  'Cetitan', 'Veluza', 'Dondozo', 'Tatsugiri', 'Annihilape', 'Clodsire',
  'Farigiraf', 'Dudunsparce', 'Kingambit', 'Great Tusk', 'Scream Tail',
  'Brute Bonnet', 'Flutter Mane', 'Slither Wing', 'Sandy Shocks', 'Iron Treads',
  'Iron Bundle', 'Iron Hands', 'Iron Jugulis', 'Iron Moth', 'Iron Thorns',
  'Frigibax', 'Arctibax', 'Baxcalibur', 'Gimmighoul', 'Gholdengo', 'Wo-Chien',
  'Chien-Pao', 'Ting-Lu', 'Chi-Yu', 'Roaring Moon', 'Iron Valiant', 'Koraidon',
  'Miraidon', 'Walking Wake', 'Iron Leaves', 'Dipplin', 'Poltchageist',
  'Sinistcha', 'Okidogi', 'Munkidori', 'Fezandipiti', 'Ogerpon', 'Archaludon',
  'Hydrapple', 'Gouging Fire', 'Raging Bolt', 'Iron Boulder', 'Iron Crown',
  'Terapagos', 'Pecharunt',
];

function titleCaseSpecies(slug: string) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function loadPokemonSpeciesNames(): Promise<string[]> {
  if (!namesPromise) {
    // Use the local list immediately so OCR never waits on pokeapi.co.
    namesPromise = Promise.resolve([...FALLBACK_NAMES]);
    void (async () => {
      try {
        const res = await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=2000');
        if (!res.ok) return;
        const data = (await res.json()) as { results: { name: string }[] };
        const names = data.results.map((r) => titleCaseSpecies(r.name));
        if (names.length > 100) namesPromise = Promise.resolve(names);
      } catch {
        /* keep fallback */
      }
    })();
  }
  return namesPromise;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CARD_SUFFIXES = ['ex', 'gx', 'v', 'vmax', 'vstar', 'lvx'];

/** Split glued suffixes like "rayquazaex" → "rayquaza ex". */
function splitGluedSuffixes(text: string) {
  return text.replace(
    new RegExp(`([a-z]{3,})(${CARD_SUFFIXES.join('|')})(?=[^a-z]|$)`, 'gi'),
    '$1 $2',
  );
}

/** Light OCR cleanup before species matching (safe substitutions only). */
function repairNameOcr(text: string) {
  return text
    .replace(/0/g, 'o')
    .replace(/1(?=[a-z])/gi, 'l')
    .replace(/(?<=[a-z])1/gi, 'l')
    .replace(/\|/g, 'l');
}

function prepareOcrText(text: string) {
  return normalizeName(splitGluedSuffixes(repairNameOcr(normalizeSuffixOcr(text))));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameAppearsIn(haystack: string, norm: string) {
  if (norm.length < 3) return false;
  // Match name alone or followed by TCG suffixes (Rayquaza GX, Rayquazaex, etc.)
  // Never use bare includes — foil garbage like "xarcanine" was matching Arcanine.
  const suffix = CARD_SUFFIXES.join('|');
  const re = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(norm)}(?:\\s*(?:${suffix}))?(?:[^a-z0-9]|$)`,
  );
  return re.test(haystack);
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i;
    row[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1];
      const cost = a[i] === b[j] ? 0 : 1;
      row[j + 1] = Math.min(row[j + 1] + 1, row[j] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

type MatchKind = 'exact' | 'fuzzy';

function fuzzyDistance(token: string, speciesNorm: string): number | null {
  if (token.length < 5 || speciesNorm.length < 5) return null;
  if (token === speciesNorm) return 0;
  // Foil noise invents random tokens — require shared start letter + similar length,
  // but allow a single first-letter OCR slip when the remainder matches (Eharmander→Charmander).
  if (token[0] !== speciesNorm[0]) {
    if (
      token.length === speciesNorm.length &&
      token.slice(1) === speciesNorm.slice(1)
    ) {
      return 1;
    }
    return null;
  }
  if (Math.abs(token.length - speciesNorm.length) > 2) return null;
  // Keep fuzzy tight: distance 3 was matching garbage → Arcanine on Rayquaza GX
  const maxDist = speciesNorm.length >= 9 ? 2 : speciesNorm.length >= 7 ? 1 : 0;
  if (maxDist === 0) return null;
  const dist = levenshtein(token, speciesNorm);
  return dist <= maxDist ? dist : null;
}

function formatDetectedName(baseName: string, haystack: string) {
  const base = normalizeName(baseName);
  if (/\bgx\b/.test(haystack) || haystack.includes(`${base}gx`)) {
    if (!/\sgx$/i.test(baseName)) return `${baseName} GX`;
  }
  if (/\bvmax\b/.test(haystack) || haystack.includes(`${base}vmax`)) {
    if (!/\svmax$/i.test(baseName)) return `${baseName} VMAX`;
  }
  if (/\bvstar\b/.test(haystack) || haystack.includes(`${base}vstar`)) {
    if (!/\svstar$/i.test(baseName)) return `${baseName} VSTAR`;
  }
  if (/\bv\b/.test(haystack) || (haystack.includes(`${base}v`) && !haystack.includes(`${base}vmax`))) {
    if (!/\sv(?:max|star)?$/i.test(baseName)) return `${baseName} V`;
  }
  const hasEx = /\bex\b/.test(haystack) || haystack.includes(`${base}ex`);
  if (hasEx && !/\sex$/i.test(baseName)) return `${baseName} ex`;
  return baseName;
}

type ScoredHit = { name: string; norm: string; kind: MatchKind; score: number };

function scoreNameHits(haystack: string, species: string[]): ScoredHit[] {
  const tokens = haystack.split(/\s+/).filter((t) => t.length >= 4);
  const hits: ScoredHit[] = [];

  for (const name of species) {
    const norm = normalizeName(name);
    if (norm.length < 3) continue;

    if (nameAppearsIn(haystack, norm)) {
      // Exact / substring hits dominate — never lose to a fuzzy false positive
      hits.push({ name, norm, kind: 'exact', score: 1000 + norm.length * 10 });
      continue;
    }

    let bestDist: number | null = null;
    for (const token of tokens) {
      const bare = token.replace(new RegExp(`(?:${CARD_SUFFIXES.join('|')})$`), '');
      for (const candidate of [bare, token]) {
        const dist = fuzzyDistance(candidate, norm);
        if (dist == null) continue;
        if (bestDist == null || dist < bestDist) bestDist = dist;
      }
      // Truncated foil titles: "Rayq" → Rayquaza (not "Dragon" → Dragonair)
      const STOP = new Set([
        'dragon',
        'basic',
        'stage',
        'ability',
        'attack',
        'retreat',
        'weakness',
        'pokemon',
        'energy',
        'break',
        'tempest',
      ]);
      if (!STOP.has(bare) && norm.startsWith(bare) && bare.length >= 4) {
        const ratio = bare.length / norm.length;
        if (ratio >= 0.5 && (bestDist == null || 2 < (bestDist ?? 99))) {
          bestDist = Math.max(1, norm.length - bare.length);
        }
      }
      if (
        !STOP.has(bare) &&
        bare.length >= 6 &&
        norm.includes(bare) &&
        bare.length >= norm.length - 2
      ) {
        const dist = Math.abs(norm.length - bare.length);
        if (bestDist == null || dist < bestDist) bestDist = Math.max(1, dist);
      }
    }
    if (bestDist != null) {
      hits.push({
        name,
        norm,
        kind: 'fuzzy',
        score: 200 - bestDist * 40 + norm.length,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || b.norm.length - a.norm.length);
  return hits;
}

function dedupeHits(hits: ScoredHit[], haystack: string, limit = 8): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if ([...seen].some((s) => s.includes(hit.norm) || hit.norm.includes(s))) continue;
    if (seen.has(hit.norm)) continue;
    seen.add(hit.norm);
    unique.push(formatDetectedName(hit.name, haystack));
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Find Pokémon species names that appear in OCR text (best match first). */
export async function findPokemonNamesInText(
  text: string,
  options?: { allowFuzzy?: boolean },
): Promise<string[]> {
  const haystack = prepareOcrText(text);
  if (haystack.length < 3) return [];

  const allowFuzzy = options?.allowFuzzy !== false;
  const species = await loadPokemonSpeciesNames();
  const hits = scoreNameHits(haystack, species);
  const exact = hits.filter((h) => h.kind === 'exact');
  if (exact.length > 0) return dedupeHits(exact, haystack);

  if (!allowFuzzy) return [];
  // Single best fuzzy only — stops foil noise inventing the wrong Pokémon
  const bestFuzzy = hits.find((h) => h.kind === 'fuzzy');
  return bestFuzzy ? dedupeHits([bestFuzzy], haystack, 1) : [];
}

/**
 * Prefer names found in the title strip. Full-card OCR is exact-only —
 * body/ability text + foil noise invent false fuzzy hits (e.g. Arcanine).
 */
export async function findPokemonNamesPreferringTitle(
  titleText: string,
  fullText: string,
): Promise<string[]> {
  const fromTitle = await findPokemonNamesInText(titleText, { allowFuzzy: true });
  if (fromTitle.length > 0) return fromTitle;
  return findPokemonNamesInText(fullText, { allowFuzzy: false });
}
