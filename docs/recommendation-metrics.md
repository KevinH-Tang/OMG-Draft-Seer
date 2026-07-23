# Recommendation Metrics

> This document describes the current recommendation implementation. `Tier List` and `Ability
> Pairs` have separate display and browsing rankings; they do not directly change a build's
> `Score`.

## Purpose and Scope

The recommender produces complete builds with this fixed shape:

```text
1 hero + 3 abilities + 1 ultimate
```

`Score` is an explainable ranking signal calculated in logit space. It is not the observed win rate
of the five-ability build and is not an official Windrun metric.

Implementation references:

- `src/core/recommendation.ts` enumerates builds, computes scores, and selects interactions.
- `src/core/pairs.ts` normalizes Pair/Triple keys and statistics.
- `src/App.tsx` renders build cards and interaction details.
- `public/data/snapshots/latest.json` supplies runtime statistics.

## Input Validation

An individual, Pair, or Triple record must have finite picks and wins with:

```text
picks > 0
0 <= wins <= picks
```

Invalid Pair and Triple records are discarded before indexing. Valid duplicate records keep the row
with the largest pick count. Duplicate individual records follow the same rule in the recommender.
An ability without a valid individual record uses a neutral `50%` base value, but cannot
participate in a Pair or Triple calculation.

## Individual Base

For each selected ability:

```text
WR_i = wins_i / picks_i
```

The five-pick base uses raw rates directly in additive logit space:

```text
Base Logit = sum(logit(WR_i))
Base WR = sigmoid(Base Logit)
logit(p) = ln(p / (1 - p))
sigmoid(x) = 1 / (1 + exp(-x))
```

Rates are used as observed. Exact `0%` and `100%` values are handled as limiting logit values for
the base helper; interactions require finite group and component logits.

## Page 4 Pair Display

The `Ability Pairs` browser follows the Windrun-compatible display formulas:

```text
Pair WR = pairWins / pairPicks
Pair Synergy = Pair WR - sqrt(WR_i * WR_j)
True Synergy = Pair WR - sigmoid(logit(WR_i) + logit(WR_j))
```

Page 4 `True Synergy` is a probability-point display. The recommendation model uses the same
additive logit baseline, but keeps its score contributions in logit units.

## Pair and Triple Effects

Only interaction records with at least 50 picks participate:

```text
groupPicks >= 50
```

For an eligible interaction group `g`:

```text
Group Logit_g = logit(groupWins_g / groupPicks_g)
Base Logit_g = sum(logit(WR_i) for i in g)
Raw Logit Delta_g = Group Logit_g - Base Logit_g
```

The raw logit delta is the score contribution. Positive and negative deltas are both retained.

## Triple Residual

A Triple enters the final Score only when all three component Pairs are available, valid, and pass
the same `picks >= 50` filter. This gives every scored Triple complete lower-order coverage:

```text
Pair coverage = 3 / 3
```

For a complete Triple, the higher-order residual is:

```text
Triple Residual = Triple Raw Logit Delta
  - Pair Residual_AB
  - Pair Residual_AC
  - Pair Residual_BC
```

Each Pair Residual and Triple Residual is keyed canonically and added at most once. The residual can
be positive or negative. A Triple with a missing component Pair is not scored; a missing Pair is never
silently treated as a zero contribution.

Incomplete Triples remain available as diagnostics. They expose the direct Triple logit delta,
`pairCoverage`, and the missing Pair IDs, but do not change `Interaction Logit`. This keeps sparse
data visible without giving an incomplete decomposition scoring authority.

## Final Score

The recommender enumerates every eligible Pair and complete Triple among the selected five abilities.
It keeps every non-zero signed effect, including overlapping groups:

```text
Interaction Logit = sum(unique Pair Residuals and complete Triple Residuals)
Final Logit = Base Logit + Interaction Logit
Score = sigmoid(Final Logit) * 100
```

The build card displays:

- `Score`: final sigmoid probability used for ranking.
- `Base WR`: the five-pick logit-base probability.
- `Synergy`: final probability lift, `Score probability - Base WR`.
- `Logit Delta`: total signed interaction contribution.

The interaction popover shows the projected probability lift and raw/final logit values for each
scored Pair or complete Triple. It also lists incomplete Triples as unscored diagnostics with their
Pair coverage and missing Pair IDs. The percentage lift is for readability; the score is accumulated
in logit space.

## Build Search

The recommender keeps confirmed picks, filters candidates by slot category, and enumerates legal
combinations. It evaluates at most 50,000 combinations. When a pool is larger, shortlist priority
uses:

- tier strength and individual logit;
- Pair effects with locked abilities;
- Triple effects with two locked abilities;
- strongest Pair and future Triple potential against the candidate reference pool.

This improves coverage of combination-driven candidates but remains an approximation when exhaustive
evaluation is unavailable.

## Validation

After refreshing snapshot inputs, run:

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
npm test
npm run build
```

The recommendation tests cover build shape, raw logit-base values, the 50-pick filter, positive and
negative effects, overlapping interactions, complete Triple residuals, partial-Triple diagnostics,
endpoint rates, invalid data, and Triple-aware shortlist behavior.
