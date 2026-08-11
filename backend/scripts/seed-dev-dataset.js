'use strict';

/**
 * The sample cinema deployment that seed-dev-data.js builds.
 *
 * Data only - no database access, no ids. Rows refer to each other by slug and
 * the runner resolves those to real ids as it goes, so nothing here guesses a
 * foreign key.
 *
 * Everything is declared active. Rows that should end up deactivated carry
 * `deactivate: true` and are switched off by a final pass, because the backend
 * refuses to create a screen under a deactivated cinema or a cinema product
 * under a deactivated cinema or product - building the graph first and
 * deactivating afterwards is the only order that satisfies those rules.
 *
 * OWNERSHIP: the seed owns the three chains named below and everything beneath
 * them. Re-running deletes and rebuilds all of it, so anything you create by
 * hand inside a PVR, INOX or Cinepolis chain will not survive the next run.
 * Nothing outside those chains is ever touched.
 */

/**
 * Marker embedded in every image URL the seed writes.
 *
 * It does double duty: picsum.photos serves a stable placeholder image for any
 * seed string, so the dashboard shows real pictures, and the marker makes the
 * seed's own rows identifiable without a schema change. `chains.logo_image_url`
 * carrying it is what lets the cleanup find its own chains even if one has been
 * renamed in the dashboard.
 */
const SEED_MARKER = 'qbusto-dev-seed';

function image(slug, width, height) {
  return `https://picsum.photos/seed/${SEED_MARKER}-${slug}/${width}/${height}`;
}

const logo = (slug) => image(slug, 320, 320);
const thumb = (slug) => image(slug, 400, 400);
const banner = (slug) => image(slug, 1200, 400);

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

const CHAINS = [
  { slug: 'pvr', name: 'PVR Cinemas', logoImageUrl: logo('chain-pvr') },
  { slug: 'inox', name: 'INOX Cinemas', logoImageUrl: logo('chain-inox') },
  // Deactivated, so the chains table has an inactive row to filter on and the
  // selectors have something to hide.
  {
    slug: 'cinepolis',
    name: 'Cinepolis India',
    logoImageUrl: logo('chain-cinepolis'),
    deactivate: true,
  },
];

// ---------------------------------------------------------------------------
// Cinemas
// ---------------------------------------------------------------------------

const CINEMAS = [
  {
    slug: 'pvr-phoenix',
    chain: 'pvr',
    code: 'PVRPHX',
    name: 'PVR Phoenix Lower Parel',
    location: 'Phoenix Mills, Senapati Bapat Marg',
    city: 'Mumbai',
    gstNumber: '27AAACP1234A1Z5',
    fssaiNumber: '11522998000123',
    activeSince: '2018-04-01',
    smsEnabled: true,
    whatsappEnabled: true,
  },
  {
    slug: 'pvr-andheri',
    chain: 'pvr',
    code: 'PVRAND',
    name: 'PVR Andheri West',
    location: 'Infiniti Mall, New Link Road',
    city: 'Mumbai',
    gstNumber: '27AAACP1234A1Z5',
    fssaiNumber: '11522998000124',
    activeSince: '2019-08-15',
    smsEnabled: true,
    whatsappEnabled: false,
  },
  {
    slug: 'pvr-juhu',
    chain: 'pvr',
    code: 'PVRJUH',
    name: 'PVR Juhu',
    location: 'Juhu Tara Road',
    city: 'Mumbai',
    activeSince: '2021-01-20',
    smsEnabled: false,
    whatsappEnabled: false,
  },
  {
    slug: 'inox-malad',
    chain: 'inox',
    code: 'INXMAL',
    name: 'INOX Malad',
    location: 'Inorbit Mall, Link Road',
    city: 'Mumbai',
    gstNumber: '27AAACI5678B1Z2',
    fssaiNumber: '11522998000200',
    activeSince: '2017-11-05',
    smsEnabled: true,
    whatsappEnabled: true,
  },
  {
    slug: 'inox-rcity',
    chain: 'inox',
    code: 'INXRCT',
    name: 'INOX R-City Ghatkopar',
    location: 'R City Mall, LBS Marg',
    city: 'Mumbai',
    gstNumber: '27AAACI5678B1Z2',
    activeSince: '2020-02-14',
    smsEnabled: true,
    whatsappEnabled: false,
  },
  {
    // Deactivated at the end: gives the cinema table an inactive row, and gives
    // the availability drawer a withdrawn-cinema case to show.
    slug: 'inox-borivali',
    chain: 'inox',
    code: 'INXBOR',
    name: 'INOX Borivali',
    location: 'Maxus Mall, Chandavarkar Road',
    city: 'Mumbai',
    activeSince: '2016-06-30',
    deactivate: true,
  },
  {
    slug: 'cine-seawoods',
    chain: 'cinepolis',
    code: 'CINSEA',
    name: 'Cinepolis Seawoods',
    location: 'Seawoods Grand Central Mall',
    city: 'Navi Mumbai',
    activeSince: '2022-09-01',
  },
];

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const SCREENS = [
  { cinema: 'pvr-phoenix', name: 'Screen 1' },
  { cinema: 'pvr-phoenix', name: 'Screen 2' },
  { cinema: 'pvr-phoenix', name: 'IMAX' },
  { cinema: 'pvr-phoenix', name: '4DX' },
  { cinema: 'pvr-andheri', name: 'Screen 1' },
  { cinema: 'pvr-andheri', name: 'Screen 2' },
  { cinema: 'pvr-andheri', name: 'Screen 3' },
  { cinema: 'pvr-andheri', name: 'Dolby Atmos' },
  { cinema: 'pvr-juhu', name: 'Screen 1' },
  { cinema: 'pvr-juhu', name: 'Screen 2' },
  // An inactive screen under an active cinema, which is the ordinary case for
  // a screen under refurbishment.
  { cinema: 'pvr-juhu', name: 'Gold Class', deactivate: true },
  { cinema: 'inox-malad', name: 'Screen 1' },
  { cinema: 'inox-malad', name: 'Screen 2' },
  { cinema: 'inox-malad', name: 'Insignia' },
  { cinema: 'inox-rcity', name: 'Screen 1' },
  { cinema: 'inox-rcity', name: 'Screen 2' },
  { cinema: 'inox-rcity', name: 'IMAX' },
  { cinema: 'inox-borivali', name: 'Screen 1' },
  { cinema: 'inox-borivali', name: 'Screen 2' },
  { cinema: 'cine-seawoods', name: 'Screen 1' },
  { cinema: 'cine-seawoods', name: 'VIP' },
];

// ---------------------------------------------------------------------------
// Categories
//
// Names are unique per chain, not globally, so PVR and INOX deliberately share
// several - which is exactly what a tenant-scoped category list has to get
// right.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    slug: 'pvr-popcorn',
    chain: 'pvr',
    name: 'Popcorn',
    description: 'Freshly popped, salted, caramel and cheese.',
    imageUrl: thumb('cat-pvr-popcorn'),
  },
  {
    slug: 'pvr-beverages',
    chain: 'pvr',
    name: 'Beverages',
    description: 'Soft drinks, water and hot beverages.',
    imageUrl: thumb('cat-pvr-beverages'),
  },
  {
    slug: 'pvr-snacks',
    chain: 'pvr',
    name: 'Snacks',
    description: 'Nachos, fries and quick bites.',
    imageUrl: thumb('cat-pvr-snacks'),
  },
  {
    slug: 'pvr-combos',
    chain: 'pvr',
    name: 'Combos',
    description: 'Value combinations of popcorn and a drink.',
    imageUrl: thumb('cat-pvr-combos'),
  },
  {
    slug: 'pvr-desserts',
    chain: 'pvr',
    name: 'Desserts',
    description: 'Cakes, ice cream and sweet treats.',
  },
  {
    slug: 'pvr-merch',
    chain: 'pvr',
    name: 'Merchandise',
    description: 'Discontinued for the 2026 season.',
    deactivate: true,
  },

  {
    slug: 'inox-popcorn',
    chain: 'inox',
    name: 'Popcorn',
    description: 'Signature INOX popcorn range.',
    imageUrl: thumb('cat-inox-popcorn'),
  },
  {
    slug: 'inox-beverages',
    chain: 'inox',
    name: 'Beverages',
    description: 'Chilled soft drinks and packaged water.',
    imageUrl: thumb('cat-inox-beverages'),
  },
  {
    slug: 'inox-snacks',
    chain: 'inox',
    name: 'Snacks',
    description: 'Nachos, puffs and savouries.',
  },
  {
    slug: 'inox-combos',
    chain: 'inox',
    name: 'Combos',
    description: 'Solo, couple and family value packs.',
    imageUrl: thumb('cat-inox-combos'),
  },
  {
    slug: 'inox-icecream',
    chain: 'inox',
    name: 'Ice Cream',
    description: 'Sundaes, cones and tubs.',
  },

  {
    slug: 'cine-snacks',
    chain: 'cinepolis',
    name: 'Snacks & Combos',
    description: 'Seawoods launch menu.',
  },
];

// ---------------------------------------------------------------------------
// Products
//
// `chainId` is never set here: the backend derives it from the category, and
// setting it would be inventing a value the service is about to overwrite.
//
// Add-ons point only at ordinary products or at nothing at all - an add-on may
// not be the parent of another add-on.
// ---------------------------------------------------------------------------

const PRODUCTS = [
  // --- PVR / Popcorn
  {
    slug: 'pvr-popcorn-regular',
    category: 'pvr-popcorn',
    name: 'Regular Salted Popcorn',
    description: 'Freshly popped and lightly salted. Serves one.',
    weight: 90,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-popcorn-regular'),
  },
  {
    slug: 'pvr-popcorn-large',
    category: 'pvr-popcorn',
    name: 'Large Salted Popcorn',
    description: 'Our biggest tub. Shares between two or three.',
    weight: 180,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-popcorn-large'),
  },
  {
    slug: 'pvr-popcorn-cheese',
    category: 'pvr-popcorn',
    name: 'Cheese Popcorn',
    description: 'Popped fresh and tossed in cheese seasoning.',
    weight: 110,
    taxSlabCode: 'GST5',
  },
  {
    slug: 'pvr-popcorn-caramel',
    category: 'pvr-popcorn',
    name: 'Caramel Popcorn',
    description: 'Slow-coated in caramel.',
    weight: 110,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-popcorn-caramel'),
  },

  // --- PVR / Beverages
  {
    slug: 'pvr-coke-regular',
    category: 'pvr-beverages',
    name: 'Coca-Cola (Regular)',
    description: '350 ml chilled.',
    taxSlabCode: 'GST12',
  },
  {
    slug: 'pvr-coke-large',
    category: 'pvr-beverages',
    name: 'Coca-Cola (Large)',
    description: '500 ml chilled.',
    taxSlabCode: 'GST12',
    imageUrl: thumb('p-pvr-coke-large'),
  },
  {
    slug: 'pvr-pepsi',
    category: 'pvr-beverages',
    name: 'Pepsi (Regular)',
    description: '350 ml chilled.',
    taxSlabCode: 'GST12',
  },
  {
    slug: 'pvr-water',
    category: 'pvr-beverages',
    name: 'Packaged Drinking Water',
    description: '1 litre sealed bottle.',
    taxSlabCode: 'GST0',
    imageUrl: thumb('p-pvr-water'),
  },
  // Inactive: a delisted product that pricing and links still reference.
  {
    slug: 'pvr-coffee',
    category: 'pvr-beverages',
    name: 'Filter Coffee',
    description: 'Withdrawn from the menu in 2026.',
    taxSlabCode: 'GST5',
    deactivate: true,
  },

  // --- PVR / Snacks
  {
    slug: 'pvr-nachos',
    category: 'pvr-snacks',
    name: 'Nachos with Salsa',
    description: 'Corn chips with tomato salsa.',
    weight: 150,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-nachos'),
  },
  {
    slug: 'pvr-nachos-cheese',
    category: 'pvr-snacks',
    name: 'Cheese Nachos',
    description: 'Corn chips smothered in cheese sauce.',
    weight: 170,
    taxSlabCode: 'GST5',
  },
  {
    slug: 'pvr-fries',
    category: 'pvr-snacks',
    name: 'French Fries',
    description: 'Salted, served hot.',
    weight: 140,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-fries'),
  },
  {
    slug: 'pvr-samosa',
    category: 'pvr-snacks',
    name: 'Samosa (2 pcs)',
    description: 'Spiced potato filling, served with chutney.',
    weight: 160,
    taxSlabCode: 'GST5',
  },

  // --- PVR / Combos
  {
    slug: 'pvr-combo-solo',
    category: 'pvr-combos',
    name: 'Movie Combo for One',
    description: 'Regular popcorn and a regular soft drink.',
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-combo-solo'),
  },
  {
    slug: 'pvr-combo-family',
    category: 'pvr-combos',
    name: 'Family Combo',
    description: 'Large popcorn, two soft drinks and nachos.',
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-pvr-combo-family'),
  },
  {
    slug: 'pvr-combo-kids',
    category: 'pvr-combos',
    name: 'Kids Combo',
    description: 'Small popcorn, juice and a cookie.',
    taxSlabCode: 'GST5',
  },

  // --- PVR / Desserts
  {
    slug: 'pvr-choco-lava',
    category: 'pvr-desserts',
    name: 'Choco Lava Cake',
    description: 'Served warm.',
    weight: 120,
    taxSlabCode: 'GST12',
  },
  {
    slug: 'pvr-icecream-tub',
    category: 'pvr-desserts',
    name: 'Vanilla Ice Cream Tub',
    description: '100 ml single-serve tub.',
    weight: 100,
    taxSlabCode: 'GST12',
  },

  // --- PVR / add-ons
  {
    slug: 'pvr-addon-cheese-dip',
    category: 'pvr-snacks',
    name: 'Extra Cheese Dip',
    description: 'Adds a second pot of cheese sauce.',
    isAddon: true,
    addonParent: 'pvr-nachos-cheese',
    taxSlabCode: 'GST5',
  },
  // Parentless add-on: attaches to any product, which the dashboard shows as
  // "Any product".
  {
    slug: 'pvr-addon-butter',
    category: 'pvr-popcorn',
    name: 'Extra Butter',
    description: 'A second helping of melted butter.',
    isAddon: true,
    taxSlabCode: 'GST5',
  },
  {
    slug: 'pvr-addon-seasoning',
    category: 'pvr-popcorn',
    name: 'Extra Seasoning',
    description: 'Peri peri or cheese seasoning sachet.',
    isAddon: true,
    addonParent: 'pvr-popcorn-regular',
    taxSlabCode: 'GST5',
  },

  // --- INOX / Popcorn
  {
    slug: 'inox-popcorn-regular',
    category: 'inox-popcorn',
    name: 'Regular Popcorn',
    description: 'Salted, freshly popped.',
    weight: 90,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-inox-popcorn-regular'),
  },
  {
    slug: 'inox-popcorn-large',
    category: 'inox-popcorn',
    name: 'Large Popcorn',
    description: 'Family-sized tub.',
    weight: 180,
    taxSlabCode: 'GST5',
  },
  {
    slug: 'inox-popcorn-periperi',
    category: 'inox-popcorn',
    name: 'Peri Peri Popcorn',
    description: 'Tossed in peri peri seasoning.',
    weight: 110,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-inox-popcorn-periperi'),
  },

  // --- INOX / Beverages
  {
    slug: 'inox-coke',
    category: 'inox-beverages',
    name: 'Coca-Cola',
    description: '400 ml chilled.',
    taxSlabCode: 'GST12',
    imageUrl: thumb('p-inox-coke'),
  },
  {
    slug: 'inox-sprite',
    category: 'inox-beverages',
    name: 'Sprite',
    description: '400 ml chilled.',
    taxSlabCode: 'GST12',
  },
  {
    slug: 'inox-water',
    category: 'inox-beverages',
    name: 'Packaged Water',
    description: '1 litre sealed bottle.',
    taxSlabCode: 'GST0',
  },

  // --- INOX / Snacks
  {
    slug: 'inox-nachos',
    category: 'inox-snacks',
    name: 'Nachos Grande',
    description: 'Loaded nachos with cheese and jalapenos.',
    weight: 200,
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-inox-nachos'),
  },
  {
    slug: 'inox-puff',
    category: 'inox-snacks',
    name: 'Veg Puff',
    description: 'Baked, served hot.',
    weight: 90,
    taxSlabCode: 'GST5',
  },

  // --- INOX / Combos
  {
    slug: 'inox-combo-solo',
    category: 'inox-combos',
    name: 'Solo Combo',
    description: 'Regular popcorn and one beverage.',
    taxSlabCode: 'GST5',
    imageUrl: thumb('p-inox-combo-solo'),
  },
  {
    slug: 'inox-combo-couple',
    category: 'inox-combos',
    name: 'Couple Combo',
    description: 'Large popcorn and two beverages.',
    taxSlabCode: 'GST5',
  },

  // --- INOX / Ice Cream
  {
    slug: 'inox-sundae',
    category: 'inox-icecream',
    name: 'Chocolate Sundae',
    description: 'Soft serve with chocolate sauce.',
    weight: 150,
    taxSlabCode: 'GST12',
  },

  // --- INOX / add-on
  {
    slug: 'inox-addon-cheese',
    category: 'inox-snacks',
    name: 'Extra Cheese',
    description: 'An extra pot of cheese sauce.',
    isAddon: true,
    addonParent: 'inox-nachos',
    taxSlabCode: 'GST5',
  },

  // --- Cinepolis
  {
    slug: 'cine-popcorn',
    category: 'cine-snacks',
    name: 'Popcorn Bucket',
    description: 'Sharing bucket, salted.',
    weight: 200,
    taxSlabCode: 'GST5',
  },
  {
    slug: 'cine-drink',
    category: 'cine-snacks',
    name: 'Soft Drink',
    description: '400 ml chilled.',
    taxSlabCode: 'GST12',
  },
];

// ---------------------------------------------------------------------------
// Cinema products
//
// (cinema_id, product_id) is unique, so every pair below appears once. Coverage
// is deliberately uneven: a product in every cinema of its chain, a product in
// exactly one, and several products in none at all, so the availability
// drawer's "not carried here" empty state is reachable.
// ---------------------------------------------------------------------------

const CINEMA_PRODUCTS = [
  // --- PVR Phoenix: the fullest catalogue
  {
    slug: 'phx-popcorn-regular',
    cinema: 'pvr-phoenix',
    product: 'pvr-popcorn-regular',
    sequence: 1,
  },
  { slug: 'phx-popcorn-large', cinema: 'pvr-phoenix', product: 'pvr-popcorn-large', sequence: 2 },
  { slug: 'phx-popcorn-cheese', cinema: 'pvr-phoenix', product: 'pvr-popcorn-cheese', sequence: 3 },
  {
    slug: 'phx-popcorn-caramel',
    cinema: 'pvr-phoenix',
    product: 'pvr-popcorn-caramel',
    sequence: 3,
  },
  { slug: 'phx-coke-regular', cinema: 'pvr-phoenix', product: 'pvr-coke-regular', sequence: 10 },
  { slug: 'phx-coke-large', cinema: 'pvr-phoenix', product: 'pvr-coke-large', sequence: 11 },
  { slug: 'phx-water', cinema: 'pvr-phoenix', product: 'pvr-water', sequence: 12 },
  { slug: 'phx-nachos', cinema: 'pvr-phoenix', product: 'pvr-nachos', sequence: 20 },
  { slug: 'phx-nachos-cheese', cinema: 'pvr-phoenix', product: 'pvr-nachos-cheese', sequence: 21 },
  { slug: 'phx-fries', cinema: 'pvr-phoenix', product: 'pvr-fries', sequence: 22 },
  { slug: 'phx-combo-solo', cinema: 'pvr-phoenix', product: 'pvr-combo-solo', sequence: 30 },
  { slug: 'phx-combo-family', cinema: 'pvr-phoenix', product: 'pvr-combo-family', sequence: 31 },
  // Only carried at Phoenix, and only for a festival window.
  {
    slug: 'phx-choco-lava',
    cinema: 'pvr-phoenix',
    product: 'pvr-choco-lava',
    sequence: 40,
    availableFrom: '2026-10-01',
    availableUntil: '2026-11-15',
  },
  {
    slug: 'phx-addon-cheese-dip',
    cinema: 'pvr-phoenix',
    product: 'pvr-addon-cheese-dip',
    sequence: 50,
  },

  // --- PVR Andheri
  {
    slug: 'and-popcorn-regular',
    cinema: 'pvr-andheri',
    product: 'pvr-popcorn-regular',
    sequence: 1,
  },
  { slug: 'and-popcorn-large', cinema: 'pvr-andheri', product: 'pvr-popcorn-large', sequence: 2 },
  { slug: 'and-coke-regular', cinema: 'pvr-andheri', product: 'pvr-coke-regular', sequence: 10 },
  { slug: 'and-water', cinema: 'pvr-andheri', product: 'pvr-water', sequence: 11 },
  { slug: 'and-nachos', cinema: 'pvr-andheri', product: 'pvr-nachos', sequence: 20 },
  { slug: 'and-combo-solo', cinema: 'pvr-andheri', product: 'pvr-combo-solo', sequence: 30 },
  { slug: 'and-samosa', cinema: 'pvr-andheri', product: 'pvr-samosa', sequence: 21 },
  // Withdrawn from this cinema: an inactive link whose availability windows
  // survive, which is the lifecycle rule the drawer warns about.
  {
    slug: 'and-coffee',
    cinema: 'pvr-andheri',
    product: 'pvr-coffee',
    sequence: 12,
    deactivate: true,
  },

  // --- PVR Juhu: the smallest PVR catalogue
  { slug: 'juh-popcorn-regular', cinema: 'pvr-juhu', product: 'pvr-popcorn-regular', sequence: 1 },
  { slug: 'juh-popcorn-caramel', cinema: 'pvr-juhu', product: 'pvr-popcorn-caramel', sequence: 2 },
  { slug: 'juh-coke-regular', cinema: 'pvr-juhu', product: 'pvr-coke-regular', sequence: 10 },
  { slug: 'juh-fries', cinema: 'pvr-juhu', product: 'pvr-fries', sequence: 20 },
  { slug: 'juh-combo-kids', cinema: 'pvr-juhu', product: 'pvr-combo-kids', sequence: 30 },

  // --- INOX Malad
  {
    slug: 'mal-popcorn-regular',
    cinema: 'inox-malad',
    product: 'inox-popcorn-regular',
    sequence: 1,
  },
  { slug: 'mal-popcorn-large', cinema: 'inox-malad', product: 'inox-popcorn-large', sequence: 2 },
  {
    slug: 'mal-popcorn-periperi',
    cinema: 'inox-malad',
    product: 'inox-popcorn-periperi',
    sequence: 3,
  },
  { slug: 'mal-coke', cinema: 'inox-malad', product: 'inox-coke', sequence: 10 },
  { slug: 'mal-water', cinema: 'inox-malad', product: 'inox-water', sequence: 11 },
  { slug: 'mal-nachos', cinema: 'inox-malad', product: 'inox-nachos', sequence: 20 },
  { slug: 'mal-combo-solo', cinema: 'inox-malad', product: 'inox-combo-solo', sequence: 30 },
  { slug: 'mal-addon-cheese', cinema: 'inox-malad', product: 'inox-addon-cheese', sequence: 50 },

  // --- INOX R-City
  {
    slug: 'rct-popcorn-regular',
    cinema: 'inox-rcity',
    product: 'inox-popcorn-regular',
    sequence: 1,
  },
  { slug: 'rct-popcorn-large', cinema: 'inox-rcity', product: 'inox-popcorn-large', sequence: 2 },
  { slug: 'rct-coke', cinema: 'inox-rcity', product: 'inox-coke', sequence: 10 },
  { slug: 'rct-sprite', cinema: 'inox-rcity', product: 'inox-sprite', sequence: 11 },
  { slug: 'rct-nachos', cinema: 'inox-rcity', product: 'inox-nachos', sequence: 20 },
  { slug: 'rct-sundae', cinema: 'inox-rcity', product: 'inox-sundae', sequence: 40 },

  // --- INOX Borivali (the cinema is deactivated afterwards)
  {
    slug: 'bor-popcorn-regular',
    cinema: 'inox-borivali',
    product: 'inox-popcorn-regular',
    sequence: 1,
  },
  { slug: 'bor-coke', cinema: 'inox-borivali', product: 'inox-coke', sequence: 10 },
  { slug: 'bor-puff', cinema: 'inox-borivali', product: 'inox-puff', sequence: 20 },

  // --- Cinepolis
  { slug: 'sea-popcorn', cinema: 'cine-seawoods', product: 'cine-popcorn', sequence: 1 },
  { slug: 'sea-drink', cinema: 'cine-seawoods', product: 'cine-drink', sequence: 2 },
];

// ---------------------------------------------------------------------------
// Availability hours
//
// Windows never overlap within one cinema product, and a day-0 ("every day")
// window is only used where that cinema product has no single-day window at
// all - the backend checks day 0 against every other day.
//
// Late-night hours are split across two days, because the API requires
// startTime < endTime. There is deliberately no 22:00 -> 02:00 row anywhere.
// ---------------------------------------------------------------------------

const AVAILABILITY = [
  // Every day, one window - the common case.
  {
    cinemaProduct: 'phx-popcorn-regular',
    dayOfWeek: 0,
    startTime: '09:00:00',
    endTime: '23:00:00',
  },
  { cinemaProduct: 'phx-popcorn-large', dayOfWeek: 0, startTime: '09:00:00', endTime: '23:00:00' },
  {
    cinemaProduct: 'and-popcorn-regular',
    dayOfWeek: 0,
    startTime: '08:30:00',
    endTime: '23:30:00',
  },
  {
    cinemaProduct: 'mal-popcorn-regular',
    dayOfWeek: 0,
    startTime: '09:00:00',
    endTime: '22:45:00',
  },
  { cinemaProduct: 'mal-combo-solo', dayOfWeek: 0, startTime: '11:00:00', endTime: '22:00:00' },
  { cinemaProduct: 'sea-popcorn', dayOfWeek: 0, startTime: '10:00:00', endTime: '22:00:00' },

  // Two windows on the same day, either side of a break.
  { cinemaProduct: 'phx-nachos-cheese', dayOfWeek: 1, startTime: '10:00:00', endTime: '18:00:00' },
  { cinemaProduct: 'phx-nachos-cheese', dayOfWeek: 1, startTime: '19:00:00', endTime: '22:30:00' },
  {
    cinemaProduct: 'juh-popcorn-caramel',
    dayOfWeek: 1,
    startTime: '12:00:00',
    endTime: '15:00:00',
  },
  {
    cinemaProduct: 'juh-popcorn-caramel',
    dayOfWeek: 1,
    startTime: '18:00:00',
    endTime: '22:00:00',
  },
  {
    cinemaProduct: 'juh-popcorn-caramel',
    dayOfWeek: 2,
    startTime: '12:00:00',
    endTime: '22:00:00',
  },
  { cinemaProduct: 'phx-fries', dayOfWeek: 6, startTime: '10:00:00', endTime: '14:00:00' },
  { cinemaProduct: 'phx-fries', dayOfWeek: 6, startTime: '15:00:00', endTime: '23:00:00' },

  // Touching windows: one ends exactly where the next begins, which the backend
  // allows and which is easy to break by accident.
  { cinemaProduct: 'phx-combo-solo', dayOfWeek: 5, startTime: '11:00:00', endTime: '17:00:00' },
  { cinemaProduct: 'phx-combo-solo', dayOfWeek: 5, startTime: '17:00:00', endTime: '23:00:00' },

  // A specific-day schedule, Monday to Friday.
  { cinemaProduct: 'phx-coke-regular', dayOfWeek: 1, startTime: '10:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'phx-coke-regular', dayOfWeek: 2, startTime: '10:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'phx-coke-regular', dayOfWeek: 3, startTime: '10:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'phx-coke-regular', dayOfWeek: 4, startTime: '10:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'phx-coke-regular', dayOfWeek: 5, startTime: '10:00:00', endTime: '23:59:59' },

  // Weekend-only.
  { cinemaProduct: 'and-combo-solo', dayOfWeek: 6, startTime: '11:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'and-combo-solo', dayOfWeek: 7, startTime: '11:00:00', endTime: '23:00:00' },
  { cinemaProduct: 'mal-nachos', dayOfWeek: 5, startTime: '17:00:00', endTime: '23:30:00' },
  { cinemaProduct: 'mal-nachos', dayOfWeek: 6, startTime: '12:00:00', endTime: '23:30:00' },
  { cinemaProduct: 'mal-nachos', dayOfWeek: 7, startTime: '12:00:00', endTime: '21:00:00' },

  // Late night, split across two days rather than expressed as 22:00 -> 02:00.
  { cinemaProduct: 'rct-popcorn-large', dayOfWeek: 3, startTime: '00:00:00', endTime: '23:59:59' },
  { cinemaProduct: 'rct-popcorn-large', dayOfWeek: 4, startTime: '00:00:00', endTime: '02:00:00' },
  { cinemaProduct: 'rct-nachos', dayOfWeek: 6, startTime: '18:00:00', endTime: '23:59:59' },
  { cinemaProduct: 'rct-nachos', dayOfWeek: 7, startTime: '00:00:00', endTime: '02:00:00' },

  // On a link that is deactivated afterwards: the windows must survive it.
  { cinemaProduct: 'and-coffee', dayOfWeek: 0, startTime: '09:00:00', endTime: '13:00:00' },

  // Under a cinema that is deactivated afterwards.
  {
    cinemaProduct: 'bor-popcorn-regular',
    dayOfWeek: 0,
    startTime: '10:00:00',
    endTime: '22:00:00',
  },

  // Everything else is left with no windows at all, which the backend reads as
  // "no time-of-day restriction".
];

// ---------------------------------------------------------------------------
// Pricing
//
// Keyed on (cinema, product, day) directly rather than on a cinema product -
// the two are parallel representations, not nested. Day 0 is the base price and
// a day-specific row overrides it.
//
// A discount amount without a discountType is rejected by the model hook, so
// rows without a discount carry no amounts at all.
// ---------------------------------------------------------------------------

const PRICING = [
  // --- PVR Phoenix: flagship pricing, with weekend premiums
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-regular', dayOfWeek: 0, basePrice: 280 },
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-regular', dayOfWeek: 6, basePrice: 320 },
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-regular', dayOfWeek: 7, basePrice: 320 },
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-large', dayOfWeek: 0, basePrice: 460 },
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-cheese', dayOfWeek: 0, basePrice: 330 },
  { cinema: 'pvr-phoenix', product: 'pvr-popcorn-caramel', dayOfWeek: 0, basePrice: 330 },
  { cinema: 'pvr-phoenix', product: 'pvr-coke-regular', dayOfWeek: 0, basePrice: 180 },
  { cinema: 'pvr-phoenix', product: 'pvr-coke-large', dayOfWeek: 0, basePrice: 240 },
  { cinema: 'pvr-phoenix', product: 'pvr-water', dayOfWeek: 0, basePrice: 60 },
  { cinema: 'pvr-phoenix', product: 'pvr-nachos', dayOfWeek: 0, basePrice: 310 },
  // Percentage discount, with per-channel overrides.
  {
    cinema: 'pvr-phoenix',
    product: 'pvr-nachos-cheese',
    dayOfWeek: 0,
    basePrice: 380,
    discountType: 'P',
    discountValue: 10,
    discountOnQr: 15,
    discountOnSeatQr: 20,
  },
  // Flat discount, midweek only.
  {
    cinema: 'pvr-phoenix',
    product: 'pvr-combo-solo',
    dayOfWeek: 3,
    basePrice: 620,
    discountType: 'F',
    discountValue: 75,
    discountOnKiosk: 100,
  },
  { cinema: 'pvr-phoenix', product: 'pvr-combo-solo', dayOfWeek: 0, basePrice: 620 },
  { cinema: 'pvr-phoenix', product: 'pvr-combo-family', dayOfWeek: 0, basePrice: 1150 },
  { cinema: 'pvr-phoenix', product: 'pvr-fries', dayOfWeek: 0, basePrice: 260 },

  // --- PVR Andheri: the same products, cheaper
  { cinema: 'pvr-andheri', product: 'pvr-popcorn-regular', dayOfWeek: 0, basePrice: 240 },
  { cinema: 'pvr-andheri', product: 'pvr-popcorn-large', dayOfWeek: 0, basePrice: 400 },
  { cinema: 'pvr-andheri', product: 'pvr-coke-regular', dayOfWeek: 0, basePrice: 160 },
  { cinema: 'pvr-andheri', product: 'pvr-nachos', dayOfWeek: 0, basePrice: 280 },
  {
    cinema: 'pvr-andheri',
    product: 'pvr-combo-solo',
    dayOfWeek: 0,
    basePrice: 560,
    discountType: 'P',
    discountValue: 5,
  },
  // Inactive price row: superseded, kept because orders reference it.
  { cinema: 'pvr-andheri', product: 'pvr-water', dayOfWeek: 0, basePrice: 50, deactivate: true },

  // --- PVR Juhu
  { cinema: 'pvr-juhu', product: 'pvr-popcorn-regular', dayOfWeek: 0, basePrice: 260 },
  { cinema: 'pvr-juhu', product: 'pvr-popcorn-caramel', dayOfWeek: 0, basePrice: 300 },
  { cinema: 'pvr-juhu', product: 'pvr-coke-regular', dayOfWeek: 0, basePrice: 170 },
  { cinema: 'pvr-juhu', product: 'pvr-combo-kids', dayOfWeek: 0, basePrice: 420 },

  // --- INOX Malad
  { cinema: 'inox-malad', product: 'inox-popcorn-regular', dayOfWeek: 0, basePrice: 250 },
  { cinema: 'inox-malad', product: 'inox-popcorn-large', dayOfWeek: 0, basePrice: 420 },
  {
    cinema: 'inox-malad',
    product: 'inox-popcorn-periperi',
    dayOfWeek: 0,
    basePrice: 300,
    discountType: 'P',
    discountValue: 10,
    discountOnCounter: 5,
  },
  { cinema: 'inox-malad', product: 'inox-coke', dayOfWeek: 0, basePrice: 170 },
  { cinema: 'inox-malad', product: 'inox-water', dayOfWeek: 0, basePrice: 55 },
  { cinema: 'inox-malad', product: 'inox-nachos', dayOfWeek: 0, basePrice: 350 },
  { cinema: 'inox-malad', product: 'inox-nachos', dayOfWeek: 6, basePrice: 390 },
  { cinema: 'inox-malad', product: 'inox-combo-solo', dayOfWeek: 0, basePrice: 540 },

  // --- INOX R-City
  { cinema: 'inox-rcity', product: 'inox-popcorn-regular', dayOfWeek: 0, basePrice: 265 },
  { cinema: 'inox-rcity', product: 'inox-popcorn-large', dayOfWeek: 0, basePrice: 440 },
  { cinema: 'inox-rcity', product: 'inox-coke', dayOfWeek: 0, basePrice: 175 },
  { cinema: 'inox-rcity', product: 'inox-sprite', dayOfWeek: 0, basePrice: 175 },
  {
    cinema: 'inox-rcity',
    product: 'inox-nachos',
    dayOfWeek: 0,
    basePrice: 365,
    discountType: 'F',
    discountValue: 40,
  },
  { cinema: 'inox-rcity', product: 'inox-sundae', dayOfWeek: 0, basePrice: 220 },

  // --- INOX Borivali (cinema deactivated afterwards)
  { cinema: 'inox-borivali', product: 'inox-popcorn-regular', dayOfWeek: 0, basePrice: 230 },
  { cinema: 'inox-borivali', product: 'inox-coke', dayOfWeek: 0, basePrice: 160 },

  // --- Cinepolis
  { cinema: 'cine-seawoods', product: 'cine-popcorn', dayOfWeek: 0, basePrice: 290 },
  { cinema: 'cine-seawoods', product: 'cine-drink', dayOfWeek: 0, basePrice: 185 },
];

// ---------------------------------------------------------------------------
// Banners
//
// One image per row - multiple banners are multiple rows, never a JSON array.
// `sequence` is unique per cinema, so numbering restarts at each one.
// ---------------------------------------------------------------------------

const BANNERS = [
  { cinema: 'pvr-phoenix', imageUrl: banner('ban-phx-1'), type: 'H', sequence: 1 },
  {
    cinema: 'pvr-phoenix',
    imageUrl: banner('ban-phx-2'),
    type: 'H',
    sequence: 2,
    startDate: '2026-08-01',
    endDate: '2026-12-31',
  },
  { cinema: 'pvr-phoenix', imageUrl: banner('ban-phx-3'), type: 'I', sequence: 3 },
  {
    cinema: 'pvr-phoenix',
    imageUrl: banner('ban-phx-4'),
    type: 'I',
    sequence: 4,
    deactivate: true,
  },

  { cinema: 'pvr-andheri', imageUrl: banner('ban-and-1'), type: 'H', sequence: 1 },
  {
    cinema: 'pvr-andheri',
    imageUrl: banner('ban-and-2'),
    type: 'I',
    sequence: 2,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  },

  { cinema: 'pvr-juhu', imageUrl: banner('ban-juh-1'), type: 'H', sequence: 1 },
  { cinema: 'pvr-juhu', imageUrl: banner('ban-juh-2'), type: 'H', sequence: 2, deactivate: true },

  { cinema: 'inox-malad', imageUrl: banner('ban-mal-1'), type: 'H', sequence: 1 },
  { cinema: 'inox-malad', imageUrl: banner('ban-mal-2'), type: 'H', sequence: 2 },
  {
    cinema: 'inox-malad',
    imageUrl: banner('ban-mal-3'),
    type: 'I',
    sequence: 3,
    startDate: '2026-07-01',
    endDate: '2027-01-01',
  },

  { cinema: 'inox-rcity', imageUrl: banner('ban-rct-1'), type: 'H', sequence: 1 },
  { cinema: 'inox-rcity', imageUrl: banner('ban-rct-2'), type: 'I', sequence: 2 },

  { cinema: 'inox-borivali', imageUrl: banner('ban-bor-1'), type: 'H', sequence: 1 },
  { cinema: 'inox-borivali', imageUrl: banner('ban-bor-2'), type: 'I', sequence: 2 },

  { cinema: 'cine-seawoods', imageUrl: banner('ban-sea-1'), type: 'H', sequence: 1 },
  { cinema: 'cine-seawoods', imageUrl: banner('ban-sea-2'), type: 'I', sequence: 2 },
];

module.exports = {
  SEED_MARKER,
  CHAINS,
  CINEMAS,
  SCREENS,
  CATEGORIES,
  PRODUCTS,
  CINEMA_PRODUCTS,
  AVAILABILITY,
  PRICING,
  BANNERS,
};
