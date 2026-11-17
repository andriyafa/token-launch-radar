// dashboard/app.js — token launch radar page. Composed in-session.
// Reads the global DATA written by main.ts (data.js) and renders the
// ranked board, the live-token view, a detail view per protocol, and a
// what-if model sandbox. No network: every value comes from the snapshot.

'use strict';

// --- small helpers -------------------------------------------------------

function mk(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function usd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function signedPct(v) {
  if (v === null || v === undefined) return 'no 7d data';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function ageLabel(days) {
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return days + 'd';
}

function shortChains(chains) {
  if (!chains || chains.length === 0) return '—';
  if (chains.length === 1) return chains[0];
  return chains[0] + ' +' + (chains.length - 1);
}

// --- the model, recomputed in the page ----------------------------------
// The submitted constants arrive in DATA.model; the sandbox overrides
// them. The arithmetic below mirrors lib/model.ts term for term, so the
// page's values agree with board.json exactly.

var MODEL = null;
var FREQS = {};
var FMAX = 1;
var FIT = null;

function catFor(category, inverted) {
  if (category === null || category === undefined) return 0.85;
  var f = FREQS[category] || 0;
  if (f < 3) return 0.72;
  var share = f / FMAX;
  return inverted ? 1 - 0.3 * share : 0.7 + 0.3 * share;
}

function growthFor(change7d, weight, floor, cap) {
  var raw = change7d === null || change7d === undefined ? 0 : change7d;
  var clamped = raw < floor ? floor : raw > cap ? cap : raw;
  return 1 + weight * (clamped / 100);
}

function matFor(ageDays, tau) {
  var capped = ageDays > tau ? tau : ageDays;
  return 0.6 + 0.4 * (capped / tau);
}

function chainFor(n, span) {
  var steps = n - 1;
  if (steps < 0) steps = 0;
  if (steps > 5) steps = 5;
  var high = 0.9 + span;
  var v = 0.9 + span * (steps / 5);
  return v > high ? high : v;
}

function concFor(tvl) {
  var share = tvl / 2753981495;
  if (share > 1) share = 1;
  return 1 + 0.08 * share;
}

function multsFor(row, opts) {
  var cat = catFor(row.category, opts.catInverted);
  var growth = growthFor(row.change_7d, opts.growthWeight, opts.growthFloor, opts.growthCap);
  var mat = matFor(row.age_days, opts.ageTau);
  var chain = chainFor(row.chains ? row.chains.length : 0, opts.chainSpan);
  var conc = concFor(row.tvl_usd);
  var fit = FIT || { scale: 0.25, exponent: 1 };
  var scale = fit.scale * (opts.base === undefined ? 1 : opts.base);
  var exponent = opts.exponent === undefined ? fit.exponent : opts.exponent;
  var raw = scale * Math.pow(row.tvl_usd, exponent) * cat * growth * mat * chain * conc;
  var value = Math.max(1, Math.round(raw));
  return { value: value, cat: cat, growth: growth, mat: mat, chain: chain, conc: conc };
}

function ivFor(row, opts) {
  return multsFor(row, opts).value;
}

// --- sandbox (pure: reads DATA.rows, never writes it) -------------------

function sandboxDefaults() {
  var m = MODEL || {};
  var fit = (m.fit && typeof m.fit.exponent === 'number') ? m.fit : { scale: 0.25, exponent: 1 };
  return {
    base: 1,
    exponent: fit.exponent,
    growthWeight: m.growth_weight === undefined ? 0.5 : m.growth_weight,
    growthFloor: m.growth_floor === undefined ? -60 : m.growth_floor,
    growthCap: m.growth_cap === undefined ? 120 : m.growth_cap,
    ageTau: m.age_tau === undefined ? 1095 : m.age_tau,
    chainSpan: m.chain_weight === undefined ? 0.18 : m.chain_weight,
    catInverted: false,
  };
}

function rankAll(params) {
  var scored = DATA.rows.map(function (row) {
    return { row: row, iv: ivFor(row, params) };
  });
  scored.sort(function (a, b) {
    if (b.iv !== a.iv) return b.iv - a.iv;
    return a.row.slug < b.row.slug ? -1 : 1;
  });
  return scored;
}

function sandboxRanking(params) {
  return rankAll(params).slice(0, 20).map(function (entry, i) {
    return {
      slug: entry.row.slug,
      name: entry.row.name,
      iv: entry.iv,
      sandboxRank: i + 1,
      submittedRank: entry.row.rank,
      delta: entry.row.rank - (i + 1),
    };
  });
}

function sandboxSummary(params) {
  var top = sandboxRanking(params);
  var inTop = {};
  top.slice(0, 10).forEach(function (e) { inTop[e.slug] = true; });
  var overlap = 0;
  DATA.rows.forEach(function (r) {
    if (r.rank <= 10 && inTop[r.slug]) overlap++;
  });
  var full = rankAll(params);
  var moved = 0;
  var biggest = null;
  full.forEach(function (entry, i) {
    var delta = entry.row.rank - (i + 1);
    if (delta !== 0) moved++;
    if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) {
      biggest = { slug: entry.row.slug, from: entry.row.rank, to: i + 1, delta: delta };
    }
  });
  return { overlap: overlap, moved: moved, biggest: biggest };
}

if (typeof window !== 'undefined') {
  window.RADAR_SANDBOX = {
    defaults: sandboxDefaults,
    implied: function (row, params) { return ivFor(row, params); },
    ranking: sandboxRanking,
    summary: sandboxSummary,
  };
}

// The model block is picked up as soon as DATA exists, so the sandbox
// works even before the page finishes building.
if (typeof DATA !== 'undefined' && DATA && DATA.model) {
  MODEL = DATA.model;
  FREQS = DATA.model.freqs || {};
  FMAX = DATA.model.fmax || 1;
  FIT = DATA.model.fit || null;
  FIT = DATA.model.fit || null;
}

// --- missing-data error state -------------------------------------------

function errorPanel() {
  var box = mk('section', 'err');
  box.appendChild(mk('h2', null, 'Radar data failed to load'));
  box.appendChild(mk('p', null, 'The board could not be built because its data file is missing or malformed. Reload the page to try again.'));
  var btn = mk('button', 'btn', 'Reload');
  btn.addEventListener('click', function () { window.location.reload(); });
  box.appendChild(btn);
  return box;
}

// --- page state ----------------------------------------------------------

var state = { tab: 'board', sort: 'rank', dir: 1, cat: '', chain: '', watch: false, pre: false, q: '' };
var hostEl = null;
var tableHost = null;
var countEl = null;
var detailHost = null;

function slugCmp(a, b) {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function readHash() {
  try {
    var params = new URLSearchParams(window.location.hash.slice(1));
    var tab = params.get('tab');
    if (tab === 'live' || tab === 'board') state.tab = tab;
    var sort = params.get('sort');
    if (sort) state.sort = sort;
    var dir = params.get('dir');
    if (dir === '-1' || dir === '1') state.dir = Number(dir);
    state.cat = params.get('cat') || '';
    state.chain = params.get('chain') || '';
    state.watch = params.get('watch') === '1';
    state.pre = params.get('pre') === '1';
    state.q = params.get('q') || '';
  } catch (e) { /* a bad hash leaves the defaults in place */ }
}

function writeHash() {
  try {
    var params = new URLSearchParams();
    params.set('tab', state.tab);
    params.set('sort', state.sort);
    params.set('dir', String(state.dir));
    if (state.cat) params.set('cat', state.cat);
    if (state.chain) params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.pre) params.set('pre', '1');
    if (state.q) params.set('q', state.q);
    window.history.replaceState(null, '', '#' + params.toString());
  } catch (e) { /* hash sync is a nicety, not a requirement */ }
}

// --- sorting -------------------------------------------------------------

function sortKeyOf(row, key) {
  if (key === 'rank') return row.rank || 0;
  if (key === 'name') return (row.name || '').toLowerCase();
  if (key === 'category') return (row.category || '').toLowerCase();
  if (key === 'chain') return ((row.chains && row.chains[0]) || '').toLowerCase();
  if (key === 'tvl') return row.tvl_usd || 0;
  if (key === 'growth') return row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
  if (key === 'age') return row.age_days || 0;
  if (key === 'iv') return state.tab === 'live' ? (row.mcap_usd || 0) : (row.implied_value_usd || 0);
  return 0;
}

function sortRows(rows) {
  var key = state.sort;
  var dir = state.dir;
  return rows.slice().sort(function (a, b) {
    var va = sortKeyOf(a, key);
    var vb = sortKeyOf(b, key);
    var cmp = 0;
    if (typeof va === 'string') cmp = va < vb ? -1 : va > vb ? 1 : 0;
    else cmp = va - vb;
    if (cmp === 0) cmp = slugCmp(a, b);
    return cmp * dir;
  });
}

// --- filtering -----------------------------------------------------------

function visibleRows() {
  var pool = state.tab === 'live' ? DATA.live : DATA.rows;
  var q = state.q.trim().toLowerCase();
  var needle = state.chain.trim().toLowerCase();
  return pool.filter(function (r) {
    if (state.cat && r.category !== state.cat) return false;
    if (needle) {
      var hit = (r.chains || []).some(function (c) { return c.toLowerCase().indexOf(needle) !== -1; });
      if (!hit) return false;
    }
    if (state.watch && !r.watchlist) return false;
    if (state.pre && r.mcap_usd !== null && r.mcap_usd !== undefined) return false;
    if (q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function clearFilters() {
  state.cat = '';
  state.chain = '';
  state.watch = false;
  state.pre = false;
  state.q = '';
  syncFilterControls();
  render();
}

// --- table ---------------------------------------------------------------

var COLUMNS = [
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Protocol' },
  { key: 'category', label: 'Category' },
  { key: 'chain', label: 'Chain' },
  { key: 'tvl', label: 'TVL' },
  { key: 'growth', label: '7d' },
  { key: 'age', label: 'Age' },
  { key: 'iv', label: 'Value' },
];

function valueLabel() {
  return state.tab === 'live' ? 'MCap' : 'Implied value';
}

function renderTable(rows) {
  var wrap = mk('div', 'table-wrap');
  var table = mk('table', 'board-table');
  var head = mk('thead');
  var hrow = mk('tr');
  COLUMNS.forEach(function (col) {
    var th = mk('th', null, col.key === 'iv' ? valueLabel() : col.label);
    if (col.key === 'rank' || col.key === 'tvl' || col.key === 'growth' || col.key === 'age' || col.key === 'iv') th.className = 'num';
    if (state.sort === col.key) th.textContent += state.dir === 1 ? ' ▲' : ' ▼';
    th.addEventListener('click', function () {
      if (state.sort === col.key) state.dir = -state.dir;
      else { state.sort = col.key; state.dir = col.key === 'rank' || col.key === 'name' || col.key === 'category' || col.key === 'chain' ? 1 : -1; }
      writeHash();
      render();
    });
    hrow.appendChild(th);
  });
  head.appendChild(hrow);
  table.appendChild(head);
  var body = mk('tbody');
  rows.forEach(function (row) {
    var tr = mk('tr');
    if (row.watchlist) tr.className = 'is-watch';
    var rankCell = mk('td', 'num', String(state.tab === 'live' ? '' : row.rank));
    if (state.tab === 'live') rankCell.textContent = '—';
    tr.appendChild(rankCell);
    var nameCell = mk('td');
    var nameLine = mk('div', 'row-name', row.name);
    if (row.watchlist) {
      var star = mk('span', 'watch-star', ' ★');
      star.title = 'On the watchlist';
      nameLine.appendChild(star);
    }
    nameCell.appendChild(nameLine);
    nameCell.appendChild(mk('div', 'row-slug', row.slug));
    tr.appendChild(nameCell);
    tr.appendChild(mk('td', null, row.category || '—'));
    tr.appendChild(mk('td', null, shortChains(row.chains)));
    tr.appendChild(mk('td', 'num', usd(row.tvl_usd)));
    tr.appendChild(mk('td', 'num', signedPct(row.change_7d)));
    tr.appendChild(mk('td', 'num', ageLabel(row.age_days)));
    var valueCell = mk('td', 'num strong', state.tab === 'live' ? (row.mcap_usd === null ? '—' : usd(row.mcap_usd)) : usd(row.implied_value_usd));
    tr.appendChild(valueCell);
    tr.addEventListener('click', function () { openDetail(row.slug); });
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function emptyState(kind) {
  var box = mk('div', 'empty');
  if (kind === 'live-pre') {
    box.appendChild(mk('p', null, 'No pre-token protocols here — every row on this tab already trades a token.'));
    var show = mk('button', 'btn', 'Show live tokens');
    show.addEventListener('click', function () { state.pre = false; syncFilterControls(); render(); });
    box.appendChild(show);
  } else {
    box.appendChild(mk('p', null, 'No protocol matches that filter.'));
    var clear = mk('button', 'btn', 'Clear filters');
    clear.addEventListener('click', clearFilters);
    box.appendChild(clear);
  }
  return box;
}

function render() {
  if (!tableHost || !countEl) return;
  tableHost.textContent = '';
  var rows = sortRows(visibleRows());
  var total = state.tab === 'live' ? DATA.live.length : DATA.rows.length;
  countEl.textContent = rows.length + ' of ' + total + ' rows';
  if (rows.length === 0) {
    tableHost.appendChild(emptyState(state.tab === 'live' && state.pre ? 'live-pre' : 'filter'));
    return;
  }
  tableHost.appendChild(renderTable(rows));
}

// --- filter bar ----------------------------------------------------------

var catSel = null;
var chainInp = null;
var watchBox = null;
var preBox = null;
var searchInp = null;
var modelPanel = null;
var sandboxPanel = null;

function uniqueSorted(values) {
  var seen = {};
  var out = [];
  values.forEach(function (v) {
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  out.sort();
  return out;
}

function buildFilterBar() {
  var bar = mk('div', 'filters');
  var cats = uniqueSorted(DATA.rows.concat(DATA.live).map(function (r) { return r.category; }));
  var chains = uniqueSorted(DATA.rows.concat(DATA.live).reduce(function (acc, r) { return acc.concat(r.chains || []); }, []));

  var catField = mk('label', 'field', 'Category ');
  catSel = mk('select');
  catSel.appendChild(mk('option', null, 'All categories'));
  catSel.options[0].value = '';
  cats.forEach(function (c) {
    var opt = mk('option', null, c);
    opt.value = c;
    catSel.appendChild(opt);
  });
  catSel.value = state.cat;
  catSel.addEventListener('change', function () { state.cat = catSel.value; writeHash(); render(); });
  catField.appendChild(catSel);
  bar.appendChild(catField);

  var chainField = mk('label', 'field', 'Chain ');
  chainInp = mk('input');
  chainInp.type = 'text';
  chainInp.placeholder = 'e.g. Ethereum';
  chainInp.setAttribute('list', 'chain-list');
  chainInp.value = state.chain;
  var list = mk('datalist');
  list.id = 'chain-list';
  chains.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    list.appendChild(opt);
  });
  chainInp.addEventListener('input', function () { state.chain = chainInp.value; writeHash(); render(); });
  chainField.appendChild(chainInp);
  chainField.appendChild(list);
  bar.appendChild(chainField);

  var watchField = mk('label', 'field check', 'Watchlist only ');
  watchBox = mk('input');
  watchBox.type = 'checkbox';
  watchBox.checked = state.watch;
  watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
  watchField.appendChild(watchBox);
  bar.appendChild(watchField);

  var preField = mk('label', 'field check', 'Pre-token only ');
  preBox = mk('input');
  preBox.type = 'checkbox';
  preBox.checked = state.pre;
  preBox.addEventListener('change', function () { state.pre = preBox.checked; writeHash(); render(); });
  preField.appendChild(preBox);
  bar.appendChild(preField);

  var searchField = mk('label', 'field', 'Search ');
  searchInp = mk('input');
  searchInp.type = 'search';
  searchInp.placeholder = 'name, slug, category, chain';
  searchInp.value = state.q;
  searchInp.addEventListener('input', function () { state.q = searchInp.value; writeHash(); render(); });
  searchField.appendChild(searchInp);
  bar.appendChild(searchField);

  var clear = mk('button', 'btn', 'Clear filters');
  clear.addEventListener('click', clearFilters);
  bar.appendChild(clear);
  return bar;
}

function syncFilterControls() {
  if (catSel) catSel.value = state.cat;
  if (chainInp) chainInp.value = state.chain;
  if (watchBox) watchBox.checked = state.watch;
  if (preBox) preBox.checked = state.pre;
  if (searchInp) searchInp.value = state.q;
}

// --- detail view ---------------------------------------------------------

function findRow(slug) {
  var all = DATA.rows.concat(DATA.live);
  for (var i = 0; i < all.length; i++) {
    if (all[i].slug === slug) return all[i];
  }
  return null;
}

function openDetail(slug) {
  var row = findRow(slug);
  if (!row || !detailHost) return;
  detailHost.textContent = '';
  detailHost.classList.add('open');
  var close = mk('button', 'detail-close', 'Close ×');
  close.addEventListener('click', function () { detailHost.textContent = ''; detailHost.classList.remove('open'); });
  detailHost.appendChild(close);
  var head = mk('div', 'detail-head');
  head.appendChild(mk('h2', null, row.name));
  if (row.watchlist) head.appendChild(mk('span', 'watch-star big', '★ Watchlist'));
  detailHost.appendChild(head);
  detailHost.appendChild(mk('p', 'detail-slug', row.slug));

  var facts = mk('dl', 'facts');
  function fact(term, value) {
    facts.appendChild(mk('dt', null, term));
    facts.appendChild(mk('dd', null, value));
  }
  fact('Listed', row.listed_at || 'unknown');
  fact('Age', ageLabel(row.age_days) + ' (' + row.age_days + ' days)');
  fact('Token status', row.mcap_usd === null ? 'No token recorded' : 'Token trading');
  fact('Market cap', row.mcap_usd === null ? '—' : usd(row.mcap_usd));
  fact('Symbol', row.symbol || '—');
  fact('Gecko ID', row.gecko_id || '—');
  fact('TVL', usd(row.tvl_usd));
  fact('7d change', signedPct(row.change_7d));
  fact('Category', row.category || '—');
  detailHost.appendChild(facts);

  var chainTitle = mk('h3', null, 'Chains (' + (row.chains || []).length + ')');
  detailHost.appendChild(chainTitle);
  var shown = (row.chains || []).slice(0, 45);
  var chainText = shown.join(', ');
  if ((row.chains || []).length > 45) chainText += ' +' + ((row.chains || []).length - 45) + ' more';
  detailHost.appendChild(mk('p', 'chain-list', chainText || '—'));

  if (row.implied_value_usd !== undefined) {
    detailHost.appendChild(mk('h3', null, 'Implied value ' + usd(row.implied_value_usd) + ' — rank #' + row.rank));
    var mults = mk('dl', 'facts mults');
    function mfact(term, value) {
      mults.appendChild(mk('dt', null, term));
      mults.appendChild(mk('dd', null, value.toFixed(3)));
    }
    mfact('CAT (category)', row.cat);
    mfact('GROWTH (7d)', row.growth);
    mfact('MAT (maturity)', row.mat);
    mfact('CHAIN (diversity)', row.chain);
    mfact('CONC (size)', row.conc);
    detailHost.appendChild(mults);
    detailHost.appendChild(mk('h3', null, 'Farm plan'));
    var steps = mk('ol', 'steps');
    (row.farm_steps || []).forEach(function (s) {
      steps.appendChild(mk('li', null, s));
    });
    detailHost.appendChild(steps);
  } else {
    detailHost.appendChild(mk('p', 'note', 'This token already trades, so there is no farm plan for it here. The board ranks protocols that record no token.'));
  }
}

// --- model panel ---------------------------------------------------------

function buildModelPanel() {
  var panel = mk('section', 'panel model-panel');
  panel.appendChild(mk('h2', null, 'How the value is worked out'));
  var m = DATA.model;
  var fit = m.fit;
  if (fit && typeof fit.exponent === 'number' && typeof fit.nComps === 'number') {
    panel.appendChild(mk('p', null, 'Implied value = fitted value law × CAT × GROWTH × MAT × CHAIN × CONC. The value law is fitted from this snapshot itself: least squares on the ' + fit.nComps + ' traded protocols that carry both a market cap and TVL gives market cap ≈ $' + Math.round(fit.scale).toLocaleString('en-US') + ' × TVL^' + fit.exponent.toFixed(2) + ' (log-log R² ' + fit.r2.toFixed(2) + '). A token is worth less per dollar of TVL as TVL grows — the exponent is below 1 in every cut of the comparables.'));
    panel.appendChild(mk('p', null, 'Blind check: holding out every fifth comparable by slug and refitting, the law predicts the held-out market caps with median log error ' + fit.oosMedianLogErr.toFixed(2) + ' (' + Math.round(fit.oosWithin2x * 100) + '% within 2×), against ' + fit.baseMedianLogErr.toFixed(2) + ' (' + Math.round(fit.baseWithin2x * 100) + '% within 2×) for one fixed multiple fitted the same way. Per-category multiples were tried and dropped — they scored worse out of sample than one fitted law.'));
  } else {
    panel.appendChild(mk('p', null, 'Implied value = fitted value law × CAT × GROWTH × MAT × CHAIN × CONC. The value law is fitted from this snapshot itself, from the traded protocols that carry both a market cap and TVL.'));
  }
  panel.appendChild(mk('p', null, 'Every term comes from the protocol\u2019s own snapshot record: its TVL, its seven-day growth, how long it has run with no token, its category\u2019s frequency, its chain count, and its size. CAT is a frequency premium: deeper categories score higher, thin ones score lower. The sandbox below can flip it to the inverted direction to see what changes. Nothing here is a hardcoded list of names.'));
  panel.appendChild(mk('p', 'model-meta', 'Snapshot ' + DATA.as_of + ' · ' + DATA.rows.length + ' pre-token rows · watchlist ' + DATA.watchlist.length + ' · model ' + m.name));
  return panel;
}

// --- page skeleton -------------------------------------------------------

function buildPage(host) {
  hostEl = host;
  readHash();

  var mast = mk('header', 'mast');
  mast.appendChild(mk('h1', null, 'Token launch radar'));
  mast.appendChild(mk('p', 'mast-meta', 'Pre-token protocols ranked by implied value — what a token would be worth if the record stayed as it is, and how to farm each one.'));
  host.appendChild(mast);

  var tabs = mk('div', 'tabs');
  var boardTab = mk('button', 'tab' + (state.tab === 'board' ? ' tab-on' : ''), 'Board');
  var liveTab = mk('button', 'tab' + (state.tab === 'live' ? ' tab-on' : ''), 'Live tokens');
  boardTab.addEventListener('click', function () { state.tab = 'board'; writeHash(); syncTabs(); render(); });
  liveTab.addEventListener('click', function () { state.tab = 'live'; writeHash(); syncTabs(); render(); });
  tabs.appendChild(boardTab);
  tabs.appendChild(liveTab);
  host.appendChild(tabs);

  modelPanel = buildModelPanel();
  host.appendChild(modelPanel);
  sandboxPanel = mk('section', 'panel sandbox');
  host.appendChild(sandboxPanel);
  buildSandbox(sandboxPanel);

  host.appendChild(buildFilterBar());
  countEl = mk('p', 'count', '');
  host.appendChild(countEl);
  tableHost = mk('div', 'table-host');
  host.appendChild(tableHost);
  detailHost = mk('section', 'detail');
  host.appendChild(detailHost);

  function syncTabs() {
    boardTab.className = 'tab' + (state.tab === 'board' ? ' tab-on' : '');
    liveTab.className = 'tab' + (state.tab === 'live' ? ' tab-on' : '');
    modelPanel.style.display = state.tab === 'board' ? '' : 'none';
    sandboxPanel.style.display = state.tab === 'board' ? '' : 'none';
  }
  window.__radarSyncTabs = syncTabs;
  syncTabs();
  render();
}

// --- model sandbox -------------------------------------------------------
// What-if controls only: they recompute from DATA.rows and never touch
// the submitted board, board.json, or data.js.

var sbParams = null;
var sbResults = null;

function buildSandbox(panel) {
  panel.appendChild(mk('h2', null, 'Model sandbox — what-if only'));
  panel.appendChild(mk('p', null, 'Change the constants to see how the ranking moves. The submitted board never changes: this panel only recomputes from the same rows.'));
  sbParams = sandboxDefaults();
  var controls = mk('div', 'sb-controls');
  var defs = [
    { key: 'base', label: 'Base scale', step: '0.1' },
    { key: 'exponent', label: 'TVL exponent', step: '0.05' },
    { key: 'growthWeight', label: 'Growth weight', step: '0.1' },
    { key: 'growthFloor', label: 'Growth floor', step: '5' },
    { key: 'growthCap', label: 'Growth cap', step: '5' },
    { key: 'ageTau', label: 'Age τ (days)', step: '30' },
    { key: 'chainSpan', label: 'Chain weight', step: '0.02' },
  ];
  var inputs = {};
  defs.forEach(function (def) {
    var field = mk('label', 'field', def.label + ' ');
    var input = mk('input');
    input.type = 'number';
    input.step = def.step;
    input.value = String(sbParams[def.key]);
    input.addEventListener('input', readSandbox);
    inputs[def.key] = input;
    field.appendChild(input);
    controls.appendChild(field);
  });
  var catField = mk('label', 'field', 'CAT direction ');
  var catSel2 = mk('select');
  var optPremium = mk('option', null, 'Frequency premium');
  optPremium.value = 'premium';
  var optInverted = mk('option', null, 'Inverted');
  optInverted.value = 'inverted';
  catSel2.appendChild(optPremium);
  catSel2.appendChild(optInverted);
  catSel2.addEventListener('change', readSandbox);
  catField.appendChild(catSel2);
  controls.appendChild(catField);
  panel.appendChild(controls);

  var reset = mk('button', 'btn', 'Reset to submitted model');
  reset.addEventListener('click', function () {
    sbParams = sandboxDefaults();
    defs.forEach(function (def) { inputs[def.key].value = String(sbParams[def.key]); });
    catSel2.value = 'premium';
    renderSandboxResults();
  });
  panel.appendChild(reset);
  sbResults = mk('div', 'sb-results');
  panel.appendChild(sbResults);

  function readSandbox() {
    var next = sandboxDefaults();
    defs.forEach(function (def) {
      var v = parseFloat(inputs[def.key].value);
      if (!Number.isNaN(v)) next[def.key] = v;
    });
    next.catInverted = catSel2.value === 'inverted';
    sbParams = next;
    renderSandboxResults();
  }
  renderSandboxResults();
}

function renderSandboxResults() {
  if (!sbResults) return;
  sbResults.textContent = '';
  var params = sbParams || sandboxDefaults();
  var top = sandboxRanking(params);
  var sum = sandboxSummary(params);
  var table = mk('table', 'sb-table');
  var head = mk('thead');
  var hrow = mk('tr');
  ['Rank', 'Protocol', 'Sandbox IV', 'Submitted rank', 'Δ rank'].forEach(function (label) {
    hrow.appendChild(mk('th', null, label));
  });
  head.appendChild(hrow);
  table.appendChild(head);
  var body = mk('tbody');
  top.forEach(function (entry) {
    var tr = mk('tr');
    tr.appendChild(mk('td', 'num', String(entry.sandboxRank)));
    tr.appendChild(mk('td', null, entry.name));
    tr.appendChild(mk('td', 'num', usd(entry.iv)));
    tr.appendChild(mk('td', 'num', '#' + entry.submittedRank));
    var delta = mk('td', 'num ' + (entry.delta > 0 ? 'delta-up' : entry.delta < 0 ? 'delta-down' : ''));
    delta.textContent = entry.delta > 0 ? '+' + entry.delta : String(entry.delta);
    tr.appendChild(delta);
    body.appendChild(tr);
  });
  table.appendChild(body);
  sbResults.appendChild(table);
  var biggest = sum.biggest;
  var line = 'Top-10 overlap with the submitted board: ' + sum.overlap + ' / 10 · ' + sum.moved + ' of 200 rows changed rank';
  if (biggest) line += ' · Biggest mover: ' + biggest.slug + ' ' + biggest.from + ' → ' + biggest.to + ' (Δ' + (biggest.delta > 0 ? '+' : '') + biggest.delta + ')';
  sbResults.appendChild(mk('p', 'sb-summary', line));
}

// --- boot ----------------------------------------------------------------

function boot() {
  var host = document.getElementById('board');
  if (!host) return;
  host.setAttribute('aria-busy', 'false');
  if (typeof DATA === 'undefined' || !DATA || !Array.isArray(DATA.rows) || !Array.isArray(DATA.live) || !DATA.model) {
    host.appendChild(errorPanel());
    return;
  }
  MODEL = DATA.model;
  FREQS = DATA.model.freqs || {};
  FMAX = DATA.model.fmax || 1;
  FIT = DATA.model.fit || null;
  buildPage(host);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
