# Score Analysis

> This document audits the current recommendation score. It describes a ranking heuristic, not an
> official Windrun metric or a calibrated five-pick win probability.

## Current Position

The score now has one clear rule for interaction eligibility: a valid Pair or Triple needs at least
50 picks. No additional probabilistic adjustment is applied.

The four active model decisions are:

1. Calculate the base and all interaction effects in logit space.
2. Calculate a complete Triple as a higher-order residual over all three eligible Pair deltas.
3. Keep signed effects, so negative synergy lowers the final score.
4. Use valid-record filtering and score-aware candidate shortlist priority.

This is transparent and easy to reproduce. It is also intentionally a heuristic because all inputs
are marginal observational statistics and overlapping groups can reuse the same games.

## Formula

### Base

For an ability `i`:

```text
WR_i = wins_i / picks_i
```

For the five selected abilities:

```text
Base Logit = sum(logit(WR_i))
Base WR = sigmoid(Base Logit)
```

The score uses the raw rate. A missing individual record uses neutral `50%` for the base, but
prevents the ability from participating in an interaction.

### Pair

For a valid Pair with at least 50 picks:

```text
Pair Logit Delta = logit(pairWins / pairPicks)
  - logit(WR_i) - logit(WR_j)
```

### Triple

For a valid Triple with at least 50 picks and three eligible component Pairs:

```text
Triple Raw Delta = logit(tripleWins / triplePicks)
  - logit(WR_i) - logit(WR_j) - logit(WR_k)

Triple Residual = Triple Raw Delta
  - Pair Logit Delta(AB)
  - Pair Logit Delta(AC)
  - Pair Logit Delta(BC)
```

The Triple residual can be positive or negative. A Triple with fewer than three eligible component
Pairs is excluded from the final Score. It is retained only as a diagnostic with `pairCoverage` and
the missing Pair IDs; a missing Pair is never assumed to have zero contribution.

### Final Score

Every non-zero Pair delta and complete Triple residual is included once, even when groups overlap:

```text
Interaction Logit = sum(unique Pair Logit Deltas and complete Triple Residuals)
Final Logit = Base Logit + Interaction Logit
Score = sigmoid(Final Logit) * 100
```

The UI's displayed Synergy is the probability lift from the interaction logit:

```text
Synergy Lift = sigmoid(Final Logit) - sigmoid(Base Logit)
```

The actual accumulation remains in logit space.

## Snapshot Audit

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

## Data Coverage and Self-Analysis

The public Windrun API does not expose a complete Pair/Triple relation in the current snapshot. The
upstream frontend repository records this as a backend threshold in [Issue #5](https://github.com/Noxville/windrun/issues/5),
which describes Ability Pairs as "only top 5k pairs". The live public endpoint currently returns
7,500 Pairs and 10,000 Triples, so the configured threshold appears to have changed while the Top-N
behavior remains.

The 2026-07-22 endpoint check found:

- `GET /api/v2/ability-pairs` returned HTTP 200 without authentication and exactly 7,500 rows.
- `GET /api/v2/ability-triplets` returned HTTP 200 without authentication and exactly 10,000 rows.
- `limit`, `offset`, `page`, and `take` query parameters did not change either row count.
- The responses exposed patch/update metadata but no `total`, `next`, cursor, or pagination field.
- The local sync script performs no slicing; it writes the returned arrays directly.

This means local analysis is feasible only within the observed Top-N sample. We can calculate raw
rates, logit deltas, complete-Triple coverage, missing-Pair diagnostics, rank stability, and sensitivity
to the `picks >= 50` gate. We cannot reconstruct an omitted Pair or Triple from the surviving marginal
statistics; assigning zero or inferring it from neighboring records would introduce an unsupported
model assumption.

Full self-analysis is feasible if match-level draft data or a complete upstream export becomes
available. The minimum useful record is the five selected abilities, match outcome, patch/time window,
and enough context to define the population. We could then aggregate canonical Pair/Triple tables
locally, apply the same patch and validity rules, and validate coverage against the upstream snapshot.
The current public API alone is insufficient for that reconstruction. A backend full export or
documented pagination/cursor endpoint is the preferred next step; a private endpoint may require
authorization, but the current public statistics endpoints do not indicate an authorization failure.

## Advantages

### Simple and Consistent Units

Base, Pair, Triple, and final accumulation all use logit units. The final sigmoid is applied once,
so probability-point interaction values are not added to a probability base.

### Direct Observed Effects

The result directly reflects the observed rates after the explicit `picks >= 50` eligibility rule.
There are no hidden parameters that silently reduce or remove an interaction.

### Triple Is Not Blindly Duplicated

Subtracting available Pair deltas makes the Triple represent higher-order evidence rather than simply
adding the direct Triple effect on top of all nested Pairs.

### Negative Evidence Is Preserved

Anti-synergy remains visible in the interaction details and can lower final logit. This makes the
score bidirectional instead of an upside-only bonus.

### Search Uses Combination Evidence

When exhaustive evaluation is too large, shortlist priority considers individual logit, locked Pair
and Triple effects, and future Pair/Triple potential. This is more aligned with the actual score than
tier-only priority.

## Remaining Risks

### 1. The Score Is Not a Fitted Joint Probability

Individual, Pair, and Triple rates are marginal observational statistics. They share games, hero
context, player population, patch, and draft position. Adding their logit deltas is coherent in unit,
but does not create a fitted likelihood model.

### 2. Overlapping Evidence Can Still Correlate

The residual decomposition prevents a Pair from being accidentally added as a separate score term
more than once. Multiple overlapping Triples can still reuse correlated games and observational
evidence. This is acceptable for a ranking heuristic but not an unbiased joint probability calculation.

### 3. Fifty Picks Is Only a Gate

The threshold prevents the smallest records from entering the score, but it does not measure
uncertainty or control false discoveries across thousands of inspected groups. A 50-pick Pair can be
much less stable than a 10,000-pick Pair even though both pass the same gate.

### 4. Sparse Triple Coverage

A Triple with a missing or sub-threshold component Pair is excluded from the Score and shown only as
an incomplete diagnostic. This avoids attributing unknown Pair effects to a Triple, but reduces the
number of Triple records that can affect ranking. Estimating missing Pair effects would require an
explicit fitted model; the score does not silently impute them.

### 5. Raw Logit Is Sensitive to Extreme Rates

Rates at exactly `0%` or `100%` have infinite logits. The base helper handles limiting values, while
interactions require finite group and component logits. This keeps invalid interaction arithmetic
out of the score, but the data pipeline should still monitor endpoint records.

### 6. Duplicate and Context Handling Is Basic

Valid duplicate records keep the row with the largest pick count instead of aggregating partitions or
weighting recency. The score does not condition on hero ownership, patch windows, draft order, or
player/match clustering beyond the supplied snapshot.

### 7. Large-Pool Search Is Approximate

The improved shortlist does not provide a formal upper bound. If more than 50,000 legal builds exist,
the global top build can still be omitted before full scoring.

## Future Improvements

The next improvements should be evaluated offline rather than added as another implicit adjustment:

- fit Pair and Triple coefficients on historical outcomes instead of assigning every delta weight 1;
- model dependence between nested Pair/Triple records if uncertainty estimates are needed later;
- add patch/time weighting, hero constraints, draft position, and match/player grouping;
- define explicit aggregation semantics for duplicate records;
- cache interaction values and add branch-and-bound or beam-search bounds;
- compare approximate shortlist results against exhaustive results on generated small pools;
- validate top-1/top-10 quality, pairwise ranking accuracy, NDCG, score rank churn, and shortlist
  recall on time-based holdouts.

## Bottom Line

The current score is a direct, signed, logit-space ranking heuristic with a `picks >= 50` interaction
filter and complete Pair coverage for scored Triples. This makes the behavior easy to audit, but
transfers more responsibility to data quality and offline validation. The highest-value next step is
measuring how well the raw logit ranking predicts future build outcomes.
