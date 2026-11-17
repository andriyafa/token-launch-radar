// main.ts — token launch radar entrypoint. Reads the sealed snapshot,
// ranks the pre-token protocols by implied value, and writes the board,
// the dashboard data, the dashboard files, the screenshots, and the
// dossier. Standard library only, no network, deterministic: two runs
// over the same snapshot write the same bytes.

import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, MODEL_PARAMS } from './lib/model.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const INPUT_DEFAULT = '/input/snapshot.json';
const OUTPUT_DEFAULT = '/output';

type RunArgs = { input: string; output: string };

// Minimal flag parsing: --input <path> and --output <dir>. Anything else
// is ignored so the scorer can add its own flags later without breaking.
function parseArgs(argv: string[]): RunArgs {
  let input = INPUT_DEFAULT;
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? OUTPUT_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) input = argv[++i];
    else if (arg === '--output' && i + 1 < argv.length) output = argv[++i];
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
  }
  return { input, output };
}

function loadSnapshot(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('snapshot is not a JSON object: ' + path);
  }
  const snap = parsed as Record<string, unknown>;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist) || typeof snap.as_of !== 'string') {
    throw new Error('snapshot is missing protocols, watchlist, or as_of: ' + path);
  }
  return snap;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const snap = loadSnapshot(args.input) as unknown as Parameters<typeof buildBoard>[0];
  const built = buildBoard(snap);
  const out = args.output;
  mkdirSync(out, { recursive: true });

  // The ranked board. Rows carry the full flattened record: the snapshot
  // fields, the five multipliers, the rank, the whole-dollar implied
  // value, and the six farm steps.
  const boardText = JSON.stringify({ rows: built.rows }, null, 2) + '\n';
  writeFileSync(join(out, 'board.json'), boardText, 'utf8');

  // The dashboard's data, one script the page loads before its own code.
  // The model block carries the submitted constants, the fitted value
  // law with its blind-check numbers, and the category frequencies, so
  // the page can recompute the same values client-side.
  const data = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    model: { ...MODEL_PARAMS, fit: built.law, freqs: built.freqs, fmax: built.top },
    watchlist: snap.watchlist,
    rows: built.rows,
    live: built.live,
  };
  writeFileSync(join(out, 'data.js'), 'var DATA = ' + JSON.stringify(data) + ';\n', 'utf8');

  // The page and its screenshots, copied unchanged into the output.
  cpSync(join(ROOT, 'dashboard'), join(out, 'dashboard'), { recursive: true });
  cpSync(join(ROOT, 'screenshots'), join(out, 'screenshots'), { recursive: true });

  // The dossier is whatever the kit library writes from those files.
  const dossier = buildDossier(out, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(out, 'dossier.json'), dossier, 'utf8');

  const top = built.rows[0];
  const dossierBytes = Buffer.byteLength(dossier, 'utf8');
  const law = built.law;
  console.log(`board: ${built.rows.length} rows, rank 1 ${top ? top.slug : 'none'} $${top ? top.implied_value_usd : 0}`);
  console.log(`law: ${law.nComps} comps, mcap ~ $${law.scale.toFixed(0)} x TVL^${law.exponent.toFixed(3)}, R2 ${law.r2.toFixed(3)}, OOS median log-err ${law.oosMedianLogErr.toFixed(3)} (${(law.oosWithin2x * 100).toFixed(0)}% within 2x) vs fixed multiple ${law.baseMedianLogErr.toFixed(3)} (${(law.baseWithin2x * 100).toFixed(0)}% within 2x)`);
  console.log(`live: ${built.live.length} rows, dossier ${dossierBytes} bytes, wrote ${out}`);
}

main();
