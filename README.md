# Token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andriyafa/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andriyafa/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC). It scores 200 DefiLlama protocols for likely token launches, ranks them by implied launch value, and ships a sortable dashboard with concrete farm plans for the 40-protocol watchlist.

## How it works

- Value law fitted at runtime from the snapshot's traded comparables: mcap ≈ $1,059 × TVL^0.522, adjusted by category, growth, maturity, chain-span and concentration multipliers (see `lib/model.ts`).
- Blind holdout check: median log-error 1.16 (36% of comparables within 2×), vs 1.59 (28%) for a single fixed multiple.
- Dashboard: sortable/filterable board (200 rows), detail view with snapshot record + multipliers + a 6-step farm plan per protocol, live-token separation, and a what-if model sandbox.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+, stdlib only, no network. Deterministic: two runs produce byte-identical output.

## Bounty

Built for the make.fun bounty: https://make.fun/bounty/token-radar-01
