# Recommendation Model

> This document describes the current recommendation implementation. `Tier List` and `Ability
Pairs` have separate display and browsing rankings; they do not directly change a build's
> `Score`.

## Model Contract

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

## Model Audit And Roadmap

### Current Position

The score has one clear rule for interaction eligibility: a valid Pair or Triple needs at least 50
picks. No additional probabilistic adjustment is applied.

The four active model decisions are:

1. Calculate the base and all interaction effects in logit space.
2. Calculate a complete Triple as a higher-order residual over all three eligible Pair deltas.
3. Keep signed effects, so negative synergy lowers the final score.
4. Use valid-record filtering and score-aware candidate shortlist priority.

This is transparent and easy to reproduce. It is also intentionally a heuristic because all inputs
are marginal observational statistics and overlapping groups can reuse the same games. The formulas
and UI projection are defined in the model contract above rather than repeated in this audit.

### Snapshot Audit

The bundled snapshot is patch `7.41d`, generated on `2026-07-22`:

| Input                         |  Count | Pick-count range |
| ----------------------------- | -----: | ---------------: |
| Individual ability statistics |    636 |   3,211 - 40,802 |
| Canonical Pair records        |  7,500 |     358 - 19,912 |
| Canonical Triple records      | 10,000 |      138 - 9,584 |

All bundled Pair and Triple records are above the current 50-pick threshold. Applying the raw logit
formulas and complete Triple residual rule gives:

| Interaction     | Eligible | Positive | Negative |
| --------------- | -------: | -------: | -------: |
| Pair            |    7,500 |    4,816 |    2,684 |
| Complete Triple |    2,472 |      982 |    1,490 |

The remaining 7,528 Triple records have incomplete Pair coverage and are diagnostics only. These are
snapshot-wide counts; a recognized build only sees IDs present in its candidate pools.

### Data Coverage And Self-Analysis

The public Windrun API does not expose a complete Pair/Triple relation in the current snapshot. The
upstream frontend repository records this as a backend threshold in
[Issue #5](https://github.com/Noxville/windrun/issues/5), which describes Ability Pairs as "only top
5k pairs". The live public endpoint currently returns 7,500 Pairs and 10,000 Triples, so the
configured threshold appears to have changed while the Top-N behavior remains.

The 2026-07-22 endpoint check found:

- `GET /api/v2/ability-pairs` returned HTTP 200 without authentication and exactly 7,500 rows.
- `GET /api/v2/ability-triplets` returned HTTP 200 without authentication and exactly 10,000 rows.
- `limit`, `offset`, `page`, and `take` query parameters did not change either row count.
- The responses exposed patch/update metadata but no `total`, `next`, cursor, or pagination field.
- The local sync script performs no slicing; it writes the returned arrays directly.

This means local analysis is feasible only within the observed Top-N sample. We can calculate raw
rates, logit deltas, complete-Triple coverage, missing-Pair diagnostics, rank stability, and
sensitivity to the `picks >= 50` gate. We cannot reconstruct an omitted Pair or Triple from the
surviving marginal statistics; assigning zero or inferring it from neighboring records would
introduce an unsupported model assumption.

Full self-analysis is feasible if match-level draft data or a complete upstream export becomes
available. The minimum useful record is the five selected abilities, match outcome, patch/time
window, and enough context to define the population. We could then aggregate canonical Pair/Triple
tables locally, apply the same patch and validity rules, and validate coverage against the upstream
snapshot. The current public API alone is insufficient for that reconstruction. A backend full
export or documented pagination/cursor endpoint is the preferred next step; a private endpoint may
require authorization, but the current public statistics endpoints do not indicate an authorization
failure.

### Advantages

- **Simple and consistent units:** Base, Pair, Triple, and final accumulation all use logit units.
  The final sigmoid is applied once, so probability-point interaction values are not added to a
  probability base.
- **Direct observed effects:** The result directly reflects observed rates after the explicit
  `picks >= 50` eligibility rule. No hidden parameters silently reduce or remove an interaction.
- **Triple is not blindly duplicated:** Subtracting available Pair deltas makes the Triple represent
  higher-order evidence instead of adding the direct Triple effect on top of all nested Pairs.
- **Negative evidence is preserved:** Anti-synergy remains visible and can lower final logit.
- **Search uses combination evidence:** Approximate shortlist priority considers individual logit,
  locked Pair and Triple effects, and future interaction potential.

### Remaining Risks

#### 1. The Score Is Not A Fitted Joint Probability

Individual, Pair, and Triple rates are marginal observational statistics. They share games, hero
context, player population, patch, and draft position. Adding their logit deltas is coherent in
unit, but does not create a fitted likelihood model.

#### 2. Overlapping Evidence Can Still Correlate

The residual decomposition prevents a Pair from being added as a separate score term more than
once. Multiple overlapping Triples can still reuse correlated games and observational evidence.
This is acceptable for a ranking heuristic but not an unbiased joint probability calculation.

#### 3. Fifty Picks Is Only A Gate

The threshold prevents the smallest records from entering the score, but it does not measure
uncertainty or control false discoveries across thousands of inspected groups. A 50-pick Pair can
be much less stable than a 10,000-pick Pair even though both pass the same gate.

#### 4. Sparse Triple Coverage

A Triple with a missing or sub-threshold component Pair is excluded from the Score and shown only as
an incomplete diagnostic. This avoids attributing unknown Pair effects to a Triple, but reduces the
number of Triple records that can affect ranking. Estimating missing Pair effects would require an
explicit fitted model; the score does not silently impute them.

#### 5. Raw Logit Is Sensitive To Extreme Rates

Rates at exactly `0%` or `100%` have infinite logits. The base helper handles limiting values, while
interactions require finite group and component logits. This keeps invalid interaction arithmetic
out of the score, but the data pipeline should still monitor endpoint records.

#### 6. Duplicate And Context Handling Is Basic

Valid duplicate records keep the row with the largest pick count instead of aggregating partitions
or weighting recency. The score does not condition on hero ownership, patch windows, draft order, or
player/match clustering beyond the supplied snapshot.

#### 7. Large-Pool Search Is Approximate

The improved shortlist does not provide a formal upper bound. If more than 50,000 legal builds
exist, the global top build can still be omitted before full scoring.

### Future Improvements

The next improvements should be evaluated offline rather than added as another implicit adjustment:

- fit Pair and Triple coefficients on historical outcomes instead of assigning every delta weight 1;
- model dependence between nested Pair/Triple records if uncertainty estimates are needed later;
- add patch/time weighting, hero constraints, draft position, and match/player grouping;
- define explicit aggregation semantics for duplicate records;
- cache interaction values and add branch-and-bound or beam-search bounds;
- compare approximate shortlist results against exhaustive results on generated small pools;
- validate top-1/top-10 quality, pairwise ranking accuracy, NDCG, score rank churn, and shortlist
  recall on time-based holdouts.

### Bottom Line

The current score is a direct, signed, logit-space ranking heuristic with a `picks >= 50` interaction
filter and complete Pair coverage for scored Triples. This makes the behavior easy to audit, but
transfers more responsibility to data quality and offline validation. The highest-value next step is
measuring how well the raw logit ranking predicts future build outcomes.
