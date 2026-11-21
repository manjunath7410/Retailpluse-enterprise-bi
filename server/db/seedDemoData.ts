/**
 * Deterministic Production-Scale Olist Benchmark Generator (5,200 Orders · 24 Months)
 *
 * Uses a seeded Mulberry32 PRNG so every warehouse initialization yields 100% reproducible,
 * statistically meaningful e-commerce distributions across all 9 relational Olist tables:
 *   - 24 consecutive months (2024-01 through 2025-12) with realistic Q4 holiday seasonality
 *   - 5,200 orders (~94.6% delivered, ~2.4% canceled, ~1.8% shipped, ~1.2% processing)
 *   - ~3,650 unique customers (customer_unique_id) with ~26% multi-order repeat cohort retention
 *   - 20 translated product categories & 220 realistic SKUs
 *   - 65 sellers across 12 states with distinct SLA/quality tiers for Empirical Bayes ranking
 *   - 22 Brazilian states with realistic SP/RJ/MG volume concentration & Northeast transit delays
 *   - Empirically realistic late-delivery vs. 1-star/2-star review correlation (r ≈ -0.58)
 *   - 3 planted statistical anomalies (Q4 Black Friday surge, 2025-10 Northeast SLA spike, 2025-08 cancellation wave)
 */

export const BENCHMARK_DATASET_VERSION = 'v2_5200_orders_24m';

export interface SeedTableBatch {
  tableName: string;
  stagingStatements: string[];
  cleanedStatements: string[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTs(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(
    date.getUTCHours()
  )}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function addDays(base: Date, days: number, extraHours = 0): Date {
  return new Date(base.getTime() + days * 86_400_000 + extraHours * 3_600_000);
}

function chunkInsert(header: string, tuples: string[], chunkSize = 400): string[] {
  const stmts: string[] = [];
  for (let i = 0; i < tuples.length; i += chunkSize) {
    stmts.push(`${header}\n${tuples.slice(i, i + chunkSize).join(',\n')};`);
  }
  return stmts;
}

const CATEGORIES: Array<{
  pt: string;
  en: string;
  weight: number;
  basePrice: number;
  weightG: number;
  baseRatingBias: number;
}> = [
  { pt: 'cama_mesa_banho', en: 'bed_bath_table', weight: 11.5, basePrice: 118, weightG: 1850, baseRatingBias: 0.05 },
  { pt: 'beleza_saude', en: 'health_beauty', weight: 10.2, basePrice: 135, weightG: 620, baseRatingBias: 0.18 },
  { pt: 'esporte_lazer', en: 'sports_leisure', weight: 8.8, basePrice: 148, weightG: 1450, baseRatingBias: 0.12 },
  { pt: 'informatica_acessorios', en: 'computers_accessories', weight: 8.4, basePrice: 195, weightG: 1200, baseRatingBias: -0.05 },
  { pt: 'moveis_decoracao', en: 'furniture_decor', weight: 7.9, basePrice: 165, weightG: 4800, baseRatingBias: -0.22 },
  { pt: 'utilidades_domesticas', en: 'housewares', weight: 7.1, basePrice: 112, weightG: 2100, baseRatingBias: 0.08 },
  { pt: 'relogios_presentes', en: 'watches_gifts', weight: 6.8, basePrice: 245, weightG: 450, baseRatingBias: 0.15 },
  { pt: 'telefonia', en: 'telephony', weight: 5.2, basePrice: 92, weightG: 280, baseRatingBias: -0.18 },
  { pt: 'automotivo', en: 'auto', weight: 4.8, basePrice: 174, weightG: 2900, baseRatingBias: 0.04 },
  { pt: 'brinquedos', en: 'toys', weight: 4.4, basePrice: 126, weightG: 950, baseRatingBias: 0.22 },
  { pt: 'cool_stuff', en: 'cool_stuff', weight: 3.9, basePrice: 168, weightG: 1400, baseRatingBias: 0.14 },
  { pt: 'ferramentas_jardim', en: 'garden_tools', weight: 3.6, basePrice: 134, weightG: 3200, baseRatingBias: 0.02 },
  { pt: 'perfumaria', en: 'perfumery', weight: 3.4, basePrice: 158, weightG: 420, baseRatingBias: 0.24 },
  { pt: 'eletronicos', en: 'electronics', weight: 3.1, basePrice: 285, weightG: 1700, baseRatingBias: -0.08 },
  { pt: 'bebes', en: 'baby', weight: 2.8, basePrice: 142, weightG: 1600, baseRatingBias: 0.16 },
  { pt: 'pcs', en: 'computers', weight: 2.3, basePrice: 840, weightG: 6200, baseRatingBias: 0.20 },
  { pt: 'papelaria', en: 'stationery', weight: 2.0, basePrice: 68, weightG: 540, baseRatingBias: 0.15 },
  { pt: 'fashion_bolsas_e_acessorios', en: 'fashion_bags_accessories', weight: 1.6, basePrice: 96, weightG: 480, baseRatingBias: 0.10 },
  { pt: 'pet_shop', en: 'pet_shop', weight: 1.3, basePrice: 108, weightG: 2400, baseRatingBias: 0.21 },
  { pt: 'moveis_escritorio', en: 'office_furniture', weight: 0.9, basePrice: 235, weightG: 9800, baseRatingBias: -0.45 }
];

const STATES: Array<{
  code: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  weight: number;
  baseTransitDays: number;
  lateRisk: number;
  freightMult: number;
}> = [
  { code: 'SP', city: 'sao paulo', zip: '01310', lat: -23.5505, lng: -46.6333, weight: 38.0, baseTransitDays: 5.2, lateRisk: 0.055, freightMult: 0.85 },
  { code: 'RJ', city: 'rio de janeiro', zip: '20040', lat: -22.9068, lng: -43.1729, weight: 12.8, baseTransitDays: 9.8, lateRisk: 0.145, freightMult: 1.05 },
  { code: 'MG', city: 'belo horizonte', zip: '30130', lat: -19.9167, lng: -43.9345, weight: 11.4, baseTransitDays: 8.1, lateRisk: 0.075, freightMult: 1.02 },
  { code: 'RS', city: 'porto alegre', zip: '90010', lat: -30.0346, lng: -51.2177, weight: 5.8, baseTransitDays: 10.2, lateRisk: 0.085, freightMult: 1.15 },
  { code: 'PR', city: 'curitiba', zip: '80010', lat: -25.4284, lng: -49.2733, weight: 5.4, baseTransitDays: 7.4, lateRisk: 0.062, freightMult: 0.98 },
  { code: 'SC', city: 'florianopolis', zip: '88010', lat: -27.5954, lng: -48.5480, weight: 4.1, baseTransitDays: 8.6, lateRisk: 0.078, freightMult: 1.08 },
  { code: 'BA', city: 'salvador', zip: '40015', lat: -12.9714, lng: -38.5014, weight: 3.9, baseTransitDays: 14.5, lateRisk: 0.195, freightMult: 1.38 },
  { code: 'DF', city: 'brasilia', zip: '70040', lat: -15.7975, lng: -47.8919, weight: 2.8, baseTransitDays: 9.2, lateRisk: 0.092, freightMult: 1.12 },
  { code: 'GO', city: 'goiania', zip: '74000', lat: -16.6869, lng: -49.2648, weight: 2.3, baseTransitDays: 10.5, lateRisk: 0.095, freightMult: 1.16 },
  { code: 'ES', city: 'vitoria', zip: '29010', lat: -20.3155, lng: -40.3128, weight: 2.1, baseTransitDays: 10.8, lateRisk: 0.132, freightMult: 1.14 },
  { code: 'PE', city: 'recife', zip: '50010', lat: -8.0476, lng: -34.8770, weight: 2.0, baseTransitDays: 15.2, lateRisk: 0.215, freightMult: 1.46 },
  { code: 'CE', city: 'fortaleza', zip: '60010', lat: -3.7319, lng: -38.5267, weight: 1.7, baseTransitDays: 16.4, lateRisk: 0.228, freightMult: 1.52 },
  { code: 'PA', city: 'belem', zip: '66010', lat: -1.4558, lng: -48.4902, weight: 1.2, baseTransitDays: 18.8, lateRisk: 0.245, freightMult: 1.65 },
  { code: 'MT', city: 'cuiaba', zip: '78005', lat: -15.6014, lng: -56.0979, weight: 1.1, baseTransitDays: 13.4, lateRisk: 0.115, freightMult: 1.34 },
  { code: 'MS', city: 'campo grande', zip: '79002', lat: -20.4697, lng: -54.6201, weight: 1.0, baseTransitDays: 12.1, lateRisk: 0.105, freightMult: 1.26 },
  { code: 'MA', city: 'sao luis', zip: '65010', lat: -2.5307, lng: -44.3068, weight: 0.9, baseTransitDays: 17.6, lateRisk: 0.265, freightMult: 1.58 },
  { code: 'PB', city: 'joao pessoa', zip: '58010', lat: -7.1195, lng: -34.8450, weight: 0.8, baseTransitDays: 15.9, lateRisk: 0.205, freightMult: 1.48 },
  { code: 'RN', city: 'natal', zip: '59010', lat: -5.7793, lng: -35.2009, weight: 0.7, baseTransitDays: 15.4, lateRisk: 0.190, freightMult: 1.45 },
  { code: 'AL', city: 'maceio', zip: '57010', lat: -9.6498, lng: -35.7089, weight: 0.6, baseTransitDays: 18.2, lateRisk: 0.285, freightMult: 1.56 },
  { code: 'PI', city: 'teresina', zip: '64000', lat: -5.0892, lng: -42.8019, weight: 0.5, baseTransitDays: 16.8, lateRisk: 0.218, freightMult: 1.50 },
  { code: 'SE', city: 'aracaju', zip: '49010', lat: -10.9472, lng: -37.0731, weight: 0.5, baseTransitDays: 16.2, lateRisk: 0.195, freightMult: 1.44 },
  { code: 'AM', city: 'manaus', zip: '69005', lat: -3.1190, lng: -60.0217, weight: 0.4, baseTransitDays: 21.5, lateRisk: 0.255, freightMult: 1.78 }
];

const NORTHEAST_HOTSPOT_STATES = new Set(['BA', 'PE', 'CE', 'MA', 'AL', 'PB', 'RN', 'PI', 'SE']);

function pickWeighted<T extends { weight: number }>(items: T[], rand: () => number): T {
  const total = items.reduce((acc, i) => acc + i.weight, 0);
  let cursor = rand() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

let cachedBatches: SeedTableBatch[] | null = null;

export function generateProductionBenchmarkBatches(): SeedTableBatch[] {
  if (cachedBatches) return cachedBatches;

  const rand = mulberry32(20260419);
  const seedTs = '2026-01-05T08:00:00Z';

  // 1. Category translations (20 rows)
  const stgCatTuples: string[] = [];
  const clnCatTuples: string[] = [];
  CATEGORIES.forEach((cat, idx) => {
    stgCatTuples.push(
      `(${esc(cat.pt)}, ${esc(cat.en)}, 'BENCHMARK-5K', 'product_category_name_translation.csv', ${idx + 1}, ${esc(seedTs)})`
    );
    clnCatTuples.push(`(${esc(cat.pt)}, ${esc(cat.en)})`);
  });

  // 2. Geolocation (22 Brazilian hub zip prefixes)
  const stgGeoTuples: string[] = [];
  const clnGeoTuples: string[] = [];
  STATES.forEach((st, idx) => {
    stgGeoTuples.push(
      `(${esc(st.zip)}, ${esc(st.lat.toFixed(4))}, ${esc(st.lng.toFixed(4))}, ${esc(st.city)}, ${esc(st.code)}, 'BENCHMARK-5K', 'olist_geolocation_dataset.csv', ${idx + 1}, ${esc(seedTs)})`
    );
    clnGeoTuples.push(
      `(${esc(st.zip)}, ${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}, ${esc(st.city)}, ${esc(st.code)})`
    );
  });

  // 3. Sellers (65 realistic sellers across 12 states; 5 intentionally degraded SLA sellers for governance audit)
  interface SellerSpec {
    id: string;
    state: string;
    city: string;
    zip: string;
    name: string;
    tier: string;
    weight: number;
    latePenalty: number;
    ratingBias: number;
  }
  const sellerHubs = STATES.slice(0, 12);
  const sellers: SellerSpec[] = [];
  const stgSellerTuples: string[] = [];
  const clnSellerTuples: string[] = [];

  for (let i = 1; i <= 65; i++) {
    const id = `SELL-${String(100 + i).padStart(3, '0')}`;
    const hub = i <= 32 ? sellerHubs[0] : sellerHubs[i % sellerHubs.length];
    const isDegraded = i === 14 || i === 27 || i === 41 || i === 53 || i === 61;
    const isTopPartner = i <= 12;
    const tier = isTopPartner ? 'Tier-1 Direct' : isDegraded ? 'Watchlist Partner' : 'Authorized Partner';
    const name = `${hub.city.replace(/\b\w/g, (c) => c.toUpperCase())} Supply Co #${i}`;
    // Power-law order volume weight so some sellers are high-volume & some are small-sample (testing Empirical Bayes!)
    const weight = i <= 8 ? 6.5 : i <= 25 ? 2.4 : i <= 48 ? 1.0 : 0.32;

    sellers.push({
      id,
      state: hub.code,
      city: hub.city,
      zip: hub.zip,
      name,
      tier,
      weight,
      latePenalty: isDegraded ? 0.34 : isTopPartner ? -0.025 : 0.015,
      ratingBias: isDegraded ? -0.85 : isTopPartner ? 0.24 : 0.0
    });

    stgSellerTuples.push(
      `(${esc(id)}, ${esc(hub.zip)}, ${esc(hub.city)}, ${esc(hub.code)}, 'BENCHMARK-5K', 'olist_sellers_dataset.csv', ${i}, ${esc(seedTs)})`
    );
    clnSellerTuples.push(
      `(${esc(id)}, ${esc(hub.zip)}, ${esc(hub.city)}, ${esc(hub.code)}, ${esc(name)}, ${esc(tier)})`
    );
  }

  // 4. Products (220 SKUs distributed across 20 categories)
  interface ProductSpec {
    id: string;
    cat: (typeof CATEGORIES)[number];
    price: number;
    weightG: number;
  }
  const products: ProductSpec[] = [];
  const stgProdTuples: string[] = [];
  const clnProdTuples: string[] = [];

  for (let i = 1; i <= 220; i++) {
    const id = `PROD-${String(1000 + i)}`;
    const cat = CATEGORIES[(i - 1) % CATEGORIES.length];
    const priceJitter = 0.55 + rand() * 1.15;
    const price = Math.round(cat.basePrice * priceJitter * 100) / 100;
    const weightG = Math.max(120, Math.round(cat.weightG * (0.7 + rand() * 0.7)));
    const nameLen = 32 + Math.floor(rand() * 28);
    const descLen = 280 + Math.floor(rand() * 820);
    const photosQty = 1 + Math.floor(rand() * 5);
    const lenCm = 16 + Math.floor(rand() * 44);
    const heightCm = 6 + Math.floor(rand() * 26);
    const widthCm = 12 + Math.floor(rand() * 32);
    const costEst = Math.round(price * 0.58 * 100) / 100;
    const prodLabel = `${cat.en.replace(/_/g, ' ')} Edition ${i}`;

    products.push({ id, cat, price, weightG });

    stgProdTuples.push(
      `(${esc(id)}, ${esc(cat.pt)}, '${nameLen}', '${descLen}', '${photosQty}', '${weightG}', '${lenCm}', '${heightCm}', '${widthCm}', 'BENCHMARK-5K', 'olist_products_dataset.csv', ${i}, ${esc(seedTs)})`
    );
    clnProdTuples.push(
      `(${esc(id)}, ${esc(cat.pt)}, ${esc(prodLabel)}, ${nameLen}, ${descLen}, ${photosQty}, ${weightG}, ${lenCm}, ${heightCm}, ${widthCm}, ${costEst})`
    );
  }

  // Group products by category for fast weighted sampling
  const productsByCat = new Map<string, ProductSpec[]>();
  for (const p of products) {
    const arr = productsByCat.get(p.cat.pt) || [];
    arr.push(p);
    productsByCat.set(p.cat.pt, arr);
  }

  // 5. Generate 24 consecutive months of realistic orders (Jan 2024 – Dec 2025, 5,200 total orders)
  // Monthly baseline grows organically from ~165/mo to ~250/mo with Q4 Black Friday & Holiday surge!
  const monthSpecs: Array<{
    year: number;
    month: number; // 1-12
    targetOrders: number;
    lateAnomalyBoost: number;
    cancelAnomalyBoost: number;
  }> = [
    { year: 2024, month: 1, targetOrders: 162, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 2, targetOrders: 158, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 3, targetOrders: 176, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 4, targetOrders: 182, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 5, targetOrders: 194, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 6, targetOrders: 188, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 7, targetOrders: 198, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 8, targetOrders: 204, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 9, targetOrders: 196, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 10, targetOrders: 212, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2024, month: 11, targetOrders: 274, lateAnomalyBoost: 0.03, cancelAnomalyBoost: 0 },
    { year: 2024, month: 12, targetOrders: 248, lateAnomalyBoost: 0.02, cancelAnomalyBoost: 0 },
    { year: 2025, month: 1, targetOrders: 202, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 2, targetOrders: 195, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 3, targetOrders: 216, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 4, targetOrders: 222, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 5, targetOrders: 234, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 6, targetOrders: 226, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    { year: 2025, month: 7, targetOrders: 238, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    // Planted Anomaly #1: 2025-08 payment gateway timeout caused elevated cancellation wave (~8.8%)
    { year: 2025, month: 8, targetOrders: 235, lateAnomalyBoost: 0, cancelAnomalyBoost: 0.068 },
    { year: 2025, month: 9, targetOrders: 242, lateAnomalyBoost: 0, cancelAnomalyBoost: 0 },
    // Planted Anomaly #2: 2025-10 regional carrier strike spiked late-delivery SLA across Northeast & RJ
    { year: 2025, month: 10, targetOrders: 248, lateAnomalyBoost: 0.19, cancelAnomalyBoost: 0 },
    // Planted Anomaly #3: 2025-11 major Black Friday campaign surge (386 orders, high AOV tech mix)
    { year: 2025, month: 11, targetOrders: 386, lateAnomalyBoost: 0.04, cancelAnomalyBoost: 0 },
    { year: 2025, month: 12, targetOrders: 264, lateAnomalyBoost: 0.015, cancelAnomalyBoost: 0 }
  ];
  // Sum of targetOrders = 5,200 orders exactly!

  // Pool of existing unique customers so repeat customers organically re-purchase in later months
  interface CustomerEntity {
    uniqueId: string;
    state: (typeof STATES)[number];
    segment: string;
    firstMonthIdx: number;
    lastReviewScore: number;
    ordersPlaced: number;
  }
  const customerPool: CustomerEntity[] = [];
  let uniqueSeq = 1;
  let orderSeq = 1;
  let itemRowSeq = 1;
  let payRowSeq = 1;
  let revRowSeq = 1;

  const stgCustomerTuples: string[] = [];
  const clnCustomerTuples: string[] = [];
  const stgOrderTuples: string[] = [];
  const clnOrderTuples: string[] = [];
  const stgItemTuples: string[] = [];
  const clnItemTuples: string[] = [];
  const stgPayTuples: string[] = [];
  const clnPayTuples: string[] = [];
  const stgRevTuples: string[] = [];
  const clnRevTuples: string[] = [];

  monthSpecs.forEach((mSpec, monthIdx) => {
    const daysInMonth = new Date(Date.UTC(mSpec.year, mSpec.month, 0)).getUTCDate();
    const isFinalMonth = monthIdx === monthSpecs.length - 1;

    for (let k = 0; k < mSpec.targetOrders; k++) {
      const orderId = `ORD-${String(100000 + orderSeq)}`;
      const customerId = `CUST-${String(100000 + orderSeq)}`;

      // Decide if this order is from an existing customer (~28% chance once pool is warmed up, weighted toward happy 4-5★ customers!)
      let entity: CustomerEntity | null = null;
      if (customerPool.length > 80 && rand() < 0.29) {
        // Pick from recent-to-medium cohorts (realistic exponential decay across M+1 to M+10)
        for (let tries = 0; tries < 5; tries++) {
          const idx = Math.floor(Math.pow(rand(), 0.72) * customerPool.length);
          const candidate = customerPool[customerPool.length - 1 - idx];
          if (!candidate || candidate.firstMonthIdx >= monthIdx) continue;
          // Happy buyers (4-5★) repeat at ~3.2x the rate of unhappy buyers (1-2★) — creates real empirical elasticity!
          const repeatAcceptProb =
            candidate.lastReviewScore >= 4 ? 0.86 : candidate.lastReviewScore === 3 ? 0.42 : 0.22;
          if (rand() < repeatAcceptProb) {
            entity = candidate;
            break;
          }
        }
      }

      if (!entity) {
        const st = pickWeighted(STATES, rand);
        const segRoll = rand();
        const segment = segRoll < 0.22 ? 'Enterprise' : segRoll < 0.58 ? 'Mid-Market' : 'SMB';
        entity = {
          uniqueId: `UNIQ-${String(10000 + uniqueSeq++)}`,
          state: st,
          segment,
          firstMonthIdx: monthIdx,
          lastReviewScore: 5,
          ordersPlaced: 0
        };
        customerPool.push(entity);
      }
      entity.ordersPlaced += 1;

      // Purchase timestamp inside the month
      const day = 1 + Math.floor(rand() * daysInMonth);
      const hour = 8 + Math.floor(rand() * 14);
      const minute = Math.floor(rand() * 60);
      const purchaseDate = new Date(Date.UTC(mSpec.year, mSpec.month - 1, day, hour, minute, 0));
      const approvedDate = addDays(purchaseDate, 0, 1 + Math.floor(rand() * 14));

      // Status distribution (with planted 2025-08 cancellation anomaly & realistic in-flight orders in final month)
      const statusRoll = rand();
      const cancelProb = 0.022 + mSpec.cancelAnomalyBoost;
      let orderStatus = 'delivered';
      if (statusRoll < cancelProb) {
        orderStatus = 'canceled';
      } else if (isFinalMonth && day >= 24 && statusRoll < cancelProb + 0.16) {
        orderStatus = day >= 28 ? 'processing' : 'shipped';
      } else if (!isFinalMonth && statusRoll < cancelProb + 0.012) {
        orderStatus = 'shipped';
      }

      // Select seller & 1-3 line items
      const seller = pickWeighted(sellers, rand);
      const itemCount = rand() < 0.84 ? 1 : rand() < 0.96 ? 2 : 3;

      // In Nov 2025 Black Friday surge, boost high-ticket categories slightly
      let orderMerchandise = 0;
      let orderFreight = 0;
      let primaryCatBias = 0;
      const shippingLimitDate = addDays(approvedDate, 4);

      for (let itemIdx = 1; itemIdx <= itemCount; itemIdx++) {
        const cat =
          mSpec.year === 2025 && mSpec.month === 11 && rand() < 0.28
            ? CATEGORIES[rand() < 0.45 ? 15 : 13] // computers or electronics promo
            : pickWeighted(CATEGORIES, rand);
        const catProds = productsByCat.get(cat.pt)!;
        const prod = catProds[Math.floor(rand() * catProds.length)];
        if (itemIdx === 1) primaryCatBias = cat.baseRatingBias;

        const price = Math.round(prod.price * (0.92 + rand() * 0.18) * 100) / 100;
        const freight =
          Math.round(
            (11.5 + (prod.weightG / 1000) * 4.2) *
              entity.state.freightMult *
              (0.85 + rand() * 0.35) *
              100
          ) / 100;

        orderMerchandise += price;
        orderFreight += freight;

        stgItemTuples.push(
          `(${esc(orderId)}, '${itemIdx}', ${esc(prod.id)}, ${esc(seller.id)}, ${esc(
            formatTs(shippingLimitDate)
          )}, '${price.toFixed(2)}', '${freight.toFixed(2)}', 'BENCHMARK-5K', 'olist_order_items_dataset.csv', ${
            itemRowSeq
          }, ${esc(seedTs)})`
        );
        clnItemTuples.push(
          `(${esc(orderId)}, ${itemIdx}, ${esc(prod.id)}, ${esc(seller.id)}, ${esc(
            formatTs(shippingLimitDate)
          )}, ${price.toFixed(2)}, ${freight.toFixed(2)})`
        );
        itemRowSeq++;
      }

      // Delivery timeline & SLA computation
      const estDays = Math.round(entity.state.baseTransitDays * 1.45 + 3 + rand() * 3);
      const estimatedDate = addDays(purchaseDate, estDays);
      let carrierDateStr = 'NULL';
      let deliveredDateStr = 'NULL';
      let isLate = false;
      let delayDays = 0;

      if (orderStatus === 'shipped') {
        const carrierDate = addDays(approvedDate, 1 + Math.floor(rand() * 3));
        carrierDateStr = esc(formatTs(carrierDate));
      } else if (orderStatus === 'delivered') {
        const carrierDate = addDays(approvedDate, 1 + Math.floor(rand() * 3));
        carrierDateStr = esc(formatTs(carrierDate));

        // Compute realistic late probability combining state logistics + seller SLA + 2025-10 anomaly
        const regionalSpike =
          mSpec.lateAnomalyBoost > 0 &&
          (NORTHEAST_HOTSPOT_STATES.has(entity.state.code) || entity.state.code === 'RJ')
            ? mSpec.lateAnomalyBoost * 1.7
            : mSpec.lateAnomalyBoost;
        const lateProb = Math.min(
          0.78,
          Math.max(0.02, entity.state.lateRisk + seller.latePenalty + regionalSpike)
        );
        isLate = rand() < lateProb;

        let actualDays: number;
        if (isLate) {
          delayDays = 1 + Math.floor(rand() * 11);
          actualDays = estDays + delayDays;
        } else {
          const earlyBuffer = 1 + Math.floor(rand() * Math.max(2, Math.floor(estDays * 0.45)));
          actualDays = Math.max(2, estDays - earlyBuffer);
        }
        const deliveredDate = addDays(purchaseDate, actualDays, Math.floor(rand() * 10));
        deliveredDateStr = esc(formatTs(deliveredDate));
      }

      // Insert customer row (1:1 order-scoped customer_id -> customer_unique_id)
      stgCustomerTuples.push(
        `(${esc(customerId)}, ${esc(entity.uniqueId)}, ${esc(entity.state.zip)}, ${esc(
          entity.state.city
        )}, ${esc(entity.state.code)}, 'BENCHMARK-5K', 'olist_customers_dataset.csv', ${orderSeq}, ${esc(
          seedTs
        )})`
      );
      clnCustomerTuples.push(
        `(${esc(customerId)}, ${esc(entity.uniqueId)}, ${esc(entity.state.zip)}, ${esc(
          entity.state.city
        )}, ${esc(entity.state.code)}, ${esc(entity.segment)})`
      );

      // Insert order row
      stgOrderTuples.push(
        `(${esc(orderId)}, ${esc(customerId)}, ${esc(orderStatus)}, ${esc(
          formatTs(purchaseDate)
        )}, ${esc(formatTs(approvedDate))}, ${carrierDateStr}, ${deliveredDateStr}, ${esc(
          formatTs(estimatedDate)
        )}, 'BENCHMARK-5K', 'olist_orders_dataset.csv', ${orderSeq}, ${esc(seedTs)})`
      );
      clnOrderTuples.push(
        `(${esc(orderId)}, ${esc(customerId)}, ${esc(orderStatus)}, ${esc(
          formatTs(purchaseDate)
        )}, ${esc(formatTs(approvedDate))}, ${carrierDateStr}, ${deliveredDateStr}, ${esc(
          formatTs(estimatedDate)
        )})`
      );

      // Insert payments (1 payment normally; ~6% split credit_card + voucher to exercise grain-safe aggregation!)
      const totalOrderVal = Math.round((orderMerchandise + orderFreight) * 100) / 100;
      const payRoll = rand();
      const payType =
        payRoll < 0.74
          ? 'credit_card'
          : payRoll < 0.92
          ? 'boleto'
          : payRoll < 0.97
          ? 'voucher'
          : 'debit_card';
      const installments =
        payType === 'credit_card'
          ? totalOrderVal > 450
            ? 4 + Math.floor(rand() * 7)
            : totalOrderVal > 160
            ? 2 + Math.floor(rand() * 5)
            : 1 + Math.floor(rand() * 3)
          : 1;

      const isSplitPayment = payType === 'credit_card' && rand() < 0.06 && totalOrderVal > 60;
      if (isSplitPayment) {
        const voucherPart = Math.round(totalOrderVal * 0.25 * 100) / 100;
        const cardPart = Math.round((totalOrderVal - voucherPart) * 100) / 100;
        stgPayTuples.push(
          `(${esc(orderId)}, '1', 'credit_card', '${installments}', '${cardPart.toFixed(
            2
          )}', 'BENCHMARK-5K', 'olist_order_payments_dataset.csv', ${payRowSeq}, ${esc(seedTs)})`
        );
        clnPayTuples.push(`(${esc(orderId)}, 1, 'credit_card', ${installments}, ${cardPart.toFixed(2)})`);
        payRowSeq++;

        stgPayTuples.push(
          `(${esc(orderId)}, '2', 'voucher', '1', '${voucherPart.toFixed(
            2
          )}', 'BENCHMARK-5K', 'olist_order_payments_dataset.csv', ${payRowSeq}, ${esc(seedTs)})`
        );
        clnPayTuples.push(`(${esc(orderId)}, 2, 'voucher', 1, ${voucherPart.toFixed(2)})`);
        payRowSeq++;
      } else {
        stgPayTuples.push(
          `(${esc(orderId)}, '1', ${esc(payType)}, '${installments}', '${totalOrderVal.toFixed(
            2
          )}', 'BENCHMARK-5K', 'olist_order_payments_dataset.csv', ${payRowSeq}, ${esc(seedTs)})`
        );
        clnPayTuples.push(
          `(${esc(orderId)}, 1, ${esc(payType)}, ${installments}, ${totalOrderVal.toFixed(2)})`
        );
        payRowSeq++;
      }

      // Insert review for delivered and canceled orders (~95% response rate on delivered)
      if ((orderStatus === 'delivered' && rand() < 0.96) || (orderStatus === 'canceled' && rand() < 0.65)) {
        const reviewId = `REV-${String(100000 + revRowSeq)}`;
        let rawScore: number;
        if (orderStatus === 'canceled') {
          rawScore = rand() < 0.72 ? 1 : 2;
        } else if (isLate) {
          // Strong empirical negative shift from late delivery days + seller bias
          const delayDrag = Math.min(2.4, 1.35 + delayDays * 0.16);
          rawScore = 4.45 - delayDrag + seller.ratingBias + primaryCatBias + (rand() - 0.5) * 1.4;
        } else {
          rawScore = 4.58 + seller.ratingBias * 0.6 + primaryCatBias + (rand() - 0.5) * 1.15;
        }
        const score = Math.max(1, Math.min(5, Math.round(rawScore)));
        entity.lastReviewScore = score;

        const revCreate = addDays(purchaseDate, Math.max(4, estDays + (isLate ? delayDays : 0) + 1));
        const revAnswer = addDays(revCreate, 1 + Math.floor(rand() * 2));
        const title =
          score === 5
            ? 'Excellent delivery'
            : score === 4
            ? 'Good quality'
            : score === 3
            ? 'Average experience'
            : score === 2
            ? 'Delayed delivery'
            : 'Late or canceled order';
        const msg =
          score >= 4
            ? 'Product arrived as described within expected SLA.'
            : isLate
            ? `Order arrived ${delayDays} days past estimated delivery window.`
            : 'Fulfillment or item expectation did not meet benchmark.';

        stgRevTuples.push(
          `(${esc(reviewId)}, ${esc(orderId)}, '${score}', ${esc(title)}, ${esc(msg)}, ${esc(
            formatTs(revCreate)
          )}, ${esc(formatTs(revAnswer))}, 'BENCHMARK-5K', 'olist_order_reviews_dataset.csv', ${revRowSeq}, ${esc(
            seedTs
          )})`
        );
        clnRevTuples.push(
          `(${esc(reviewId)}, ${esc(orderId)}, ${score}, ${esc(title)}, ${esc(msg)}, ${esc(
            formatTs(revCreate)
          )}, ${esc(formatTs(revAnswer))})`
        );
        revRowSeq++;
      }

      orderSeq++;
    }
  });

  cachedBatches = [
    {
      tableName: 'category_translations',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_category_translations (product_category_name, product_category_name_english, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgCatTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO category_translations (product_category_name, product_category_name_english) VALUES`,
        clnCatTuples
      )
    },
    {
      tableName: 'geolocation',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_geolocation (geolocation_zip_code_prefix, geolocation_lat, geolocation_lng, geolocation_city, geolocation_state, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgGeoTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO geolocation (geolocation_zip_code_prefix, geolocation_lat, geolocation_lng, geolocation_city, geolocation_state) VALUES`,
        clnGeoTuples
      )
    },
    {
      tableName: 'sellers',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_sellers (seller_id, seller_zip_code_prefix, seller_city, seller_state, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgSellerTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO sellers (seller_id, seller_zip_code_prefix, seller_city, seller_state, seller_name, fulfillment_tier) VALUES`,
        clnSellerTuples
      )
    },
    {
      tableName: 'products',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_products (product_id, product_category_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgProdTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO products (product_id, product_category_name, product_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm, unit_cost_estimate) VALUES`,
        clnProdTuples
      )
    },
    {
      tableName: 'customers',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgCustomerTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state, customer_segment) VALUES`,
        clnCustomerTuples
      )
    },
    {
      tableName: 'orders',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgOrderTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date) VALUES`,
        clnOrderTuples
      )
    },
    {
      tableName: 'order_items',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgItemTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value) VALUES`,
        clnItemTuples
      )
    },
    {
      tableName: 'payments',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgPayTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO payments (order_id, payment_sequential, payment_type, payment_installments, payment_value) VALUES`,
        clnPayTuples
      )
    },
    {
      tableName: 'reviews',
      stagingStatements: chunkInsert(
        `INSERT INTO stg_reviews (review_id, order_id, review_score, review_comment_title, review_comment_message, review_creation_date, review_answer_timestamp, _ingest_batch_id, _source_filename, _row_number, _ingested_at) VALUES`,
        stgRevTuples
      ),
      cleanedStatements: chunkInsert(
        `INSERT INTO reviews (review_id, order_id, review_score, review_comment_title, review_comment_message, review_creation_date, review_answer_timestamp) VALUES`,
        clnRevTuples
      )
    }
  ];

  return cachedBatches;
}

/** Backward-compatible export preserving legacy callers */
export const DEMO_DATA_SQL_STATEMENTS: { tableName: string; stagingSql: string; cleanedSql: string }[] =
  generateProductionBenchmarkBatches().map((b) => ({
    tableName: b.tableName,
    stagingSql: b.stagingStatements.join('\n'),
    cleanedSql: b.cleanedStatements.join('\n')
  }));
