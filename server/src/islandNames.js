import { ISLAND_NAME_STYLES } from '../../shared/constants.js';

// ── Word Pools ────────────────────────────────────────────────

// Classic pirate: spooky, nautical, swashbuckling
const CLASSIC_ADJ = [
  'Black', 'Dead', 'Cursed', 'Ghost', 'Bone', 'Silent', 'Lost',
  'Forgotten', 'Sunken', 'Broken', 'Iron', 'Bloody', 'Crimson',
  'Ebony', 'Jagged', 'Shadow', 'Stormy', 'Savage', 'Rusted',
  'Haunted', 'Buried', 'Weeping', 'Hollow', 'Whispering', 'Salt',
  'Midnight', 'Howling', 'Coral', 'Feral', 'Frostbitten',
];
const CLASSIC_NOUN = [
  'Cove', 'Reef', 'Isle', 'Bay', 'Keys', 'Rock', 'Point', 'Shores',
  'Fang', 'Hollow', 'Skull', 'Crown', 'Tomb', 'Hook', 'Lagoon',
  'Atoll', 'Shoal', 'Gallows', 'Cutlass', 'Anchor', 'Raven', 'Kraken',
  'Mast', 'Bones', 'Spine', 'Wreck', 'Echo', 'Gulch', 'Spire', 'Throne',
];
// Possessive-style: "<person>'s <noun>"
const CLASSIC_OWNER = [
  "Dead Man", "Blackbeard", "Captain", "Admiral", "Privateer",
  "Hangman", "Cutthroat", "Kraken", "Widow", "Ghost",
  "Sea Dog", "Siren", "Buccaneer", "Corsair",
];

// Silly pirate: gross, absurd, comedic
const SILLY_ADJ = [
  'Soggy', 'Stinky', 'Rotten', 'Greasy', 'Crusty', 'Drunken',
  'Hairy', 'Scurvy', 'Sloppy', 'Moldy', 'Wobbly', 'Farting',
  'Burping', 'Sneezing', 'Grumpy', 'Cranky', 'Bumpy', 'Lumpy',
  'Chunky', 'Questionable', 'Tangy', 'Suspicious', 'Damp',
  'Itchy', 'Gassy', 'Leaky', 'Lopsided',
];
const SILLY_NOUN = [
  'Biscuit', 'Keg', 'Barnacle', 'Puddle', 'Pickle', 'Boil',
  'Wart', 'Sneeze', 'Belch', 'Hiccup', 'Dumpling', 'Sandwich',
  'Toe', 'Toenail', 'Nostril', 'Sock', 'Armpit', 'Mustache',
  'Bucket', 'Trousers', 'Gumboil', 'Kneecap', 'Nubbin', 'Snot',
];
const SILLY_OWNER = [
  "Stubby", "Bumblefoot", "Peg-leg", "Jolly", "Wobbles", "Doc",
  "Smelly Pete", "One-eye", "Crusty Jim", "Mad Mary", "Noodle-arm",
  "Toothless", "Tipsy Tom", "Three-fingered Tim", "Old Flatulent",
];

// Dirty pirate: 18+ bawdy/lewd humor (opt-in)
const DIRTY_ADJ = [
  'Thick', 'Swollen', 'Throbbing', 'Sticky', 'Wet', 'Stiff',
  'Horny', 'Blue-balled', 'Manky', 'Moist', 'Turgid', 'Pendulous',
  'Jiggling', 'Saggy', 'Randy', 'Wobbling',
];
const DIRTY_NOUN = [
  'Cock', 'Tit', 'Knob', 'Shaft', 'Crack', 'Hole', 'Willy',
  'Bollock', 'Nut', 'Prick', 'Dong', 'Nipple', 'Tush', 'Bum',
  'Arse', 'Crotch', 'Udder', 'Sack',
];
const DIRTY_OWNER = [
  'Cocksure Jack', 'Fanny', "Ol' Ballsack", 'Throbbin', 'Dick-hand',
  'Knobshine', 'Humpy', 'Randy Roger', 'Blueball Billy',
  'Moist Mary', 'Stiffy', 'Nutter Pete', 'Saucy Sal',
];

// ── Helpers ────────────────────────────────────────────────────

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Generate a single name in a specific flavor
function generateFor(flavor, rng) {
  const adj = flavor === 'silly' ? SILLY_ADJ : flavor === 'dirty' ? DIRTY_ADJ : CLASSIC_ADJ;
  const noun = flavor === 'silly' ? SILLY_NOUN : flavor === 'dirty' ? DIRTY_NOUN : CLASSIC_NOUN;
  const owner = flavor === 'silly' ? SILLY_OWNER : flavor === 'dirty' ? DIRTY_OWNER : CLASSIC_OWNER;

  const pattern = rng();
  if (pattern < 0.55) {
    // "Adj Noun"
    return `${pick(adj, rng)} ${pick(noun, rng)}`;
  } else if (pattern < 0.85) {
    // "Owner's Noun"
    return `${pick(owner, rng)}'s ${pick(noun, rng)}`;
  } else {
    // "Adj Adj Noun" (rare, extra flavor)
    let a1 = pick(adj, rng);
    let a2 = pick(adj, rng);
    let tries = 0;
    while (a1 === a2 && tries < 5) { a2 = pick(adj, rng); tries++; }
    return `${a1} ${a2} ${pick(noun, rng)}`;
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Generate an island name in the chosen style.
 * For MIXED, one of the three flavors is picked at random per name.
 * Returns a string like "Black Cove" or "Stubby's Biscuit".
 */
export function generateIslandName(style = ISLAND_NAME_STYLES.CLASSIC, rng = Math.random) {
  let flavor;
  switch (style) {
    case ISLAND_NAME_STYLES.SILLY: flavor = 'silly'; break;
    case ISLAND_NAME_STYLES.DIRTY: flavor = 'dirty'; break;
    case ISLAND_NAME_STYLES.MIXED: {
      const roll = rng();
      flavor = roll < 0.4 ? 'classic' : roll < 0.8 ? 'silly' : 'dirty';
      break;
    }
    case ISLAND_NAME_STYLES.CLASSIC:
    default:
      flavor = 'classic';
  }
  return generateFor(flavor, rng);
}

/**
 * Assign unique names to all islands in a map.
 * Mutates islands[id].name. Skips obstacles.
 * Falls back to appending a numeric suffix if all attempts collide.
 */
export function assignIslandNames(islands, style = ISLAND_NAME_STYLES.CLASSIC, rng = Math.random) {
  const used = new Set();
  for (const [id, island] of Object.entries(islands)) {
    if (island.type === 'obstacle') continue;
    let name;
    for (let attempt = 0; attempt < 20; attempt++) {
      name = generateIslandName(style, rng);
      if (!used.has(name)) break;
    }
    if (used.has(name)) name = `${name} ${Object.keys(islands).indexOf(id) + 1}`;
    used.add(name);
    island.name = name;
  }
}
