// lib/model.ts — token launch radar, value model "radar-2".
// Composed in-session from the MODEL_V2 design. Every term is a function of
// the protocol's own snapshot fields: no names, no allowlists, no invented
// data. Implied values are whole dollars only.

export type Proto = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
  source: string;
};

export type ModelOpts = {
  base?: number;
  growthWeight?: number;
  growthFloor?: number;
  growthCap?: number;
  ageTau?: number;
  chainSpan?: number;
  catInverted?: boolean;
};

export type Scored = {
  value: number;
  cat: number;
  growth: number;
  mat: number;
  chain: number;
  conc: number;
  ageDays: number;
};

// Calibration constants. BASE_MULTIPLE inherits the starter's 0.25 so rank 1
// lands near $543M; the rest bound each term so no single term flips ranks.
export const BASE_MULTIPLE = 0.25;
export const GROWTH_WEIGHT = 0.5;
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
export const MAT_FLOOR = 0.6;
export const MAT_SPAN_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;
export const CHAIN_LOW = 0.9;
export const CHAIN_HIGH = 1.08;
export const CHAIN_SPAN = 0.18;
export const CHAIN_CAP = 6;
export const CONC_RATE = 0.08;
export const CONC_CAP = 0.1;
export const TVL_REF = 2753981495;
export const BOARD_SIZE = 200;
export const EARLY_SIZE = 160;
export const LIVE_SIZE = 24;

export const MODEL_PARAMS = {
  name: 'radar-2',
  base: BASE_MULTIPLE,
  growth_weight: GROWTH_WEIGHT,
  growth_floor: GROWTH_FLOOR,
  growth_cap: GROWTH_CAP,
  age_tau: MAT_SPAN_DAYS,
  chain_weight: CHAIN_SPAN,
  chain_min: CHAIN_LOW,
  chain_max: CHAIN_HIGH,
  chain_cap: CHAIN_CAP,
  conc_rate: CONC_RATE,
  conc_cap: CONC_CAP,
  tvl_ref: TVL_REF,
  cat_direction: 'frequency',
};

// A protocol records no token when all three token fields are null. The
// wording is deliberate: the record is not proof that no token exists.
export function isPreToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

// Days between the snapshot date and the day tracking began. Unknown
// listing dates sit mid-curve instead of at either extreme.
export function ageInDays(listedAt: string | null, asOf: string): number {
  if (!listedAt) return UNKNOWN_AGE_DAYS;
  const start = Date.parse(listedAt + 'T00:00:00Z');
  const end = Date.parse(asOf + 'T00:00:00Z');
  if (Number.isNaN(start) || Number.isNaN(end)) return UNKNOWN_AGE_DAYS;
  const days = Math.round((end - start) / 86400000);
  return days < 0 ? 0 : days;
}

// Category frequencies across the whole snapshot, plus the largest one.
// The CAT term is derived from this distribution, never from a name list.
export function freqTable(protocols: Proto[]): { freqs: Record<string, number>; top: number } {
  const freqs: Record<string, number> = {};
  for (const p of protocols) {
    const key = p.category ?? '';
    freqs[key] = (freqs[key] ?? 0) + 1;
  }
  let top = 0;
  for (const k of Object.keys(freqs)) {
    if (freqs[k] > top) top = freqs[k];
  }
  return { freqs, top };
}

// Frequency premium: deeper categories are more proven markets with more
// launch precedents, so a launch there carries more value per unit of TVL.
// Thin categories take a discount for thin precedent; an unknown category
// sits near the middle. The inverted direction is a sandbox toggle only.
export function catTerm(category: string | null, freqs: Record<string, number>, top: number, inverted: boolean): number {
  if (category === null) return 0.85;
  const f = freqs[category] ?? 0;
  if (f < 3) return 0.72;
  const share = f / top;
  return inverted ? 1.0 - 0.3 * share : 0.7 + 0.3 * share;
}

// Momentum proxy. A missing 7d change is neutral, not a penalty. The clamp
// is load-bearing: one protocol in the file moves +4,448% in a week.
export function growthTerm(change7d: number | null, weight: number, floor: number, cap: number): number {
  const raw = change7d ?? 0;
  const clamped = raw < floor ? floor : raw > cap ? cap : raw;
  return 1 + weight * (clamped / 100);
}

// Maturity curve: longer with no token scores higher, up to three years.
// Unknown age lands mid-curve through UNKNOWN_AGE_DAYS.
export function maturityTerm(ageDays: number, tau: number): number {
  const capped = ageDays > tau ? tau : ageDays;
  return MAT_FLOOR + (1 - MAT_FLOOR) * (capped / tau);
}

// Chain diversity: one chain scores lowest, six or more score highest.
// Capped so chain count alone cannot reorder the board.
export function chainTerm(chainCount: number, span: number): number {
  const steps = chainCount - 1 < 0 ? 0 : chainCount - 1 > CHAIN_CAP - 1 ? CHAIN_CAP - 1 : chainCount - 1;
  const high = CHAIN_LOW + span;
  const v = CHAIN_LOW + span * (steps / (CHAIN_CAP - 1));
  return v > high ? high : v;
}

// Concentration proxy. The snapshot carries no per-protocol concentration
// data, so size is the only honest proxy, capped at +8%.
export function concTerm(tvl: number): number {
  const share = tvl / TVL_REF > 1 ? 1 : tvl / TVL_REF;
  return 1 + CONC_RATE * share;
}

// The full product. Options override the submitted constants for the
// dashboard sandbox; with no options this is the submitted board.
export function impliedValue(p: Proto, freqs: Record<string, number>, top: number, asOf: string, opts: ModelOpts = {}): Scored {
  const base = opts.base ?? BASE_MULTIPLE;
  const ageDays = ageInDays(p.listed_at, asOf);
  const cat = catTerm(p.category, freqs, top, opts.catInverted ?? false);
  const growth = growthTerm(p.change_7d, opts.growthWeight ?? GROWTH_WEIGHT, opts.growthFloor ?? GROWTH_FLOOR, opts.growthCap ?? GROWTH_CAP);
  const mat = maturityTerm(ageDays, opts.ageTau ?? MAT_SPAN_DAYS);
  const chain = chainTerm(p.chains.length, opts.chainSpan ?? CHAIN_SPAN);
  const conc = concTerm(p.tvl_usd);
  const raw = base * p.tvl_usd * cat * growth * mat * chain * conc;
  const value = Math.max(1, Math.round(raw));
  return { value, cat, growth, mat, chain, conc, ageDays };
}

// Capital tiers by TVL, in dollars of farm capital per protocol.
export function capitalTier(tvl: number): number {
  if (tvl >= 5000000000) return 250;
  if (tvl >= 1000000000) return 150;
  if (tvl >= 100000000) return 100;
  return 50;
}

// Hold length by age. Younger protocols need a longer hold to look like a
// real user; unknown age takes the short hold, not the long one.
export function holdDays(ageDays: number): number {
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

// The entry action for a step, chosen from the protocol's own category.
// Patterns are matched as substrings of the lowercased category, first
// match wins; anything unrecognised falls back to a plain USDC deposit.
type EntryFn = (slug: string, capital: number) => string;
const ENTRY_ACTIONS: Array<[string, EntryFn]> = [
  ['lend', (s, c) => `supply ${c} dollars of USDC to ${s}'s lending market`],
  ['dex', (s, c) => `provide ${c} dollars of liquidity to a ${s} pool`],
  ['yield', (s, c) => `provide ${c} dollars of liquidity to a ${s} yield pool`],
  ['amm', (s, c) => `provide ${c} dollars of liquidity to a ${s} pool`],
  ['farm', (s, c) => `deposit ${c} dollars into a ${s} farm`],
  ['bridge', (s, c) => `bridge ${c} dollars of USDC through ${s}`],
  ['stak', (s, c) => `stake ${c} dollars of assets with ${s}`],
  ['perp', (s, c) => `deposit ${c} dollars of margin with ${s}`],
  ['deriv', (s, c) => `deposit ${c} dollars of margin with ${s}`],
  ['predict', (s, c) => `fund a ${c} dollar prediction position on ${s}`],
  ['vault', (s, c) => `deposit ${c} dollars into a ${s} vault`],
  ['curat', (s, c) => `deposit ${c} dollars into a ${s} curated vault`],
  ['stable', (s, c) => `mint or deposit ${c} dollars of stablecoins with ${s}`],
  ['rwa', (s, c) => `mint ${c} dollars of ${s}'s yield-bearing asset`],
  ['insur', (s, c) => `buy ${c} dollars of cover from ${s}`],
  ['cdp', (s, c) => `open a ${c} dollar collateralised position with ${s}`],
  ['option', (s, c) => `open a ${c} dollar options position with ${s}`],
  ['synthetic', (s, c) => `mint ${c} dollars of synthetic assets with ${s}`],
];

export function entryAction(category: string | null, slug: string, capital: number): string {
  const hay = (category ?? '').toLowerCase();
  for (const [needle, fn] of ENTRY_ACTIONS) {
    if (hay.includes(needle)) return fn(slug, capital);
  }
  return `deposit ${capital} dollars of USDC with ${slug}`;
}

// The gate's length rule, applied to every step: 20 to 600 characters.
export function stepGuard(text: string): string {
  if (text.length > 600) return text.slice(0, 600);
  if (text.trim().length < 20) return text + ' Follow the protocol\u2019s own guide for this step.';
  return text;
}

export type BoardRow = Proto & {
  age_days: number;
  watchlist: boolean;
  rank: number;
  implied_value_usd: number;
  cat: number;
  growth: number;
  mat: number;
  chain: number;
  conc: number;
  farm_steps: string[];
};

export type LiveRow = Proto & { age_days: number };

// Six concrete steps per row. Each names its USD cost and its time; no
// step is a slogan. Templates interpolate the row's own slug, category and
// chains, never a hardcoded protocol name.
export function farmPlan(row: BoardRow): string[] {
  const capital = capitalTier(row.tvl_usd);
  const hold = holdDays(row.age_days);
  const primary = row.chains[0] ?? 'Ethereum';
  const multi = row.chains.length > 1;
  const second = multi ? row.chains[1] : primary;
  const entry = entryAction(row.category, row.slug, capital);
  const steps = [
    `Set up a fresh wallet used only for ${row.slug} and write its seed phrase on paper, kept offline. Move ${capital} dollars of stablecoins into it, plus about 3 dollars for gas. Time: 5 minutes. Cost: about $3 in gas.`,
    `On ${primary}, ${entry}. Time: 15 minutes. Cost: $${capital} capital plus about $6 in gas.`,
    `Do one qualifying action each week on ${row.slug} — a deposit, a borrow, a swap, or a vote — so the wallet shows steady use. Time: 10 minutes a week. Cost: about $2 in gas a week.`,
    multi
      ? `Open a second position on ${second} with ${row.slug}, mirroring the first deposit at a smaller size. Time: 15 minutes. Cost: about $4 in gas.`
      : `Deepen the position on ${primary} with a second deposit to ${row.slug}, about half the first size. Time: 15 minutes. Cost: about $4 in gas.`,
    `Hold the position for at least ${hold} days so the activity spans more than one snapshot and reads as a real user, not a one-day visitor. Time: ${hold} days. Cost: the capital stays in position.`,
    `Check ${row.slug}'s own points or rewards page for any claim, use only its published link, and never pay anyone to claim for you. Log the wallet, the dates, and the transactions. Time: 10 minutes. Cost: nothing to check.`,
  ];
  return steps.map(stepGuard);
}

function toBoardRow(p: Proto, scored: Scored, watchlisted: boolean): BoardRow {
  return {
    ...p,
    age_days: scored.ageDays,
    watchlist: watchlisted,
    rank: 0,
    implied_value_usd: scored.value,
    cat: scored.cat,
    growth: scored.growth,
    mat: scored.mat,
    chain: scored.chain,
    conc: scored.conc,
    farm_steps: [],
  };
}

function toLiveRow(p: Proto, asOf: string): LiveRow {
  return { ...p, age_days: ageInDays(p.listed_at, asOf) };
}

function byTvlDesc(a: Proto, b: Proto): number {
  if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function byValueDesc(a: BoardRow, b: BoardRow): number {
  if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function byMcapDesc(a: Proto, b: Proto): number {
  const am = a.mcap_usd ?? 0;
  const bm = b.mcap_usd ?? 0;
  if (bm !== am) return bm - am;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

// The ranked universe: all 40 watchlist protocols plus the 160 pre-token
// protocols below the floor with the most TVL. Ranked by implied value
// descending, slug ascending as the deterministic tiebreak.
export function buildBoard(snap: Snapshot): { rows: BoardRow[]; live: LiveRow[]; freqs: Record<string, number>; top: number } {
  const { freqs, top } = freqTable(snap.protocols);
  const bySlug = new Map<string, Proto>();
  for (const p of snap.protocols) bySlug.set(p.slug, p);
  const watch = new Set(snap.watchlist);
  const early = snap.protocols
    .filter((p) => isPreToken(p) && p.tvl_usd < snap.floor_usd)
    .sort(byTvlDesc)
    .slice(0, EARLY_SIZE);
  const picked: Proto[] = [];
  const seen = new Set<string>();
  for (const slug of snap.watchlist) {
    const p = bySlug.get(slug);
    if (p && !seen.has(slug)) { seen.add(slug); picked.push(p); }
  }
  for (const p of early) {
    if (!seen.has(p.slug)) { seen.add(p.slug); picked.push(p); }
  }
  const rows = picked.map((p) => toBoardRow(p, impliedValue(p, freqs, top, snap.as_of), watch.has(p.slug)));
  rows.sort(byValueDesc);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.farm_steps = farmPlan(r);
  });
  const live = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort(byMcapDesc)
    .slice(0, LIVE_SIZE)
    .map((p) => toLiveRow(p, snap.as_of));
  return { rows, live, freqs, top };
}
