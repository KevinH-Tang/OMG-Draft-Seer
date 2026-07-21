# Recommendation Data Metrics

> 本文只描述推荐器当前实现；`Tier List` 和 `Ability Pairs` 页面有各自的展示排序和样本门槛。

## Scope

本文档定义推荐方案使用的 Windrun 数据字段、计算口径和前端展示方式。
实现位置主要是：

- `scripts/sync-windrun.ts`：从 Windrun API 生成本地快照。
- `public/data/snapshots/latest.json`：运行时读取的本地数据。
- `src/core/recommendation.ts`：推荐指标和方案评分。
- `src/App.tsx`：推荐卡片展示。

推荐指标使用小数参与计算，前端按百分比或顺位格式化展示。

## Source Data

### Single abilities

Windrun `/api/v2/abilities` 返回 `data.abilityStats`，映射关系如下：

| Windrun field | Local field | Meaning |
| --- | --- | --- |
| `abilityId` | `abilityId` | Ability ID |
| `numPicks` | `picks` | Cumulative pick count, used for sample weighting |
| `wins` | `wins` | Win count |
| `avgPickPosition` | `avgPickPosition` | Average pick order, normally 1 to 50 |

`picks` is a cumulative count. It is not `Avg Pick #` and must not be displayed as pick position.

### Ability pairs

Windrun `/api/v2/ability-pairs` returns pair statistics:

| Windrun field | Local field | Meaning |
| --- | --- | --- |
| `abilityIdOne` | `abilityIdOne` | First ability ID |
| `abilityIdTwo` | `abilityIdTwo` | Second ability ID |
| `numPicks` | `picks` | Pair sample count |
| `wins` | `wins` | Pair win count |

The local snapshot also contains `tripletStats` from `/api/v2/ability-triplets`. The current
recommendation score does not use triplet statistics; the `Ability Pairs` page uses them only
to show comparable hidden three-ability combinations.

## Ability WR

For ability `i`, the raw win rate is:

```text
Raw WR_i = wins_i / numPicks_i
```

The implementation uses light Bayesian smoothing with a 50-pick prior:

```text
Effective WR_i = (wins_i + 25) / (numPicks_i + 50)
```

The sample weight is:

```text
weight_i = numPicks_i / (numPicks_i + 50)
```

For a four-ability build, the displayed `Ability WR` is the normalized weighted average:

```text
Ability WR =
  Σ(Effective WR_i × weight_i) / Σ(weight_i)
```

The result is displayed as a percentage, for example `54.7%`.
Because the current Windrun snapshot has tens of thousands of picks for normal abilities, its smoothed value is normally close to the raw Windrun win rate.

If an ability has no usable statistic, it contributes neither to the numerator nor denominator. If the entire build has no usable statistics, the fallback Ability WR is `50%`.

## Synergy

Only pairs with at least 30 samples participate:

```text
pairPicks >= 30
```

This threshold belongs to the recommendation score. The `Ability Pairs` page uses its own
default display threshold of 50 picks (`MIN_ABILITY_PAIR_PICKS`).

For a valid pair `(i, j)`:

```text
Pair WR = pairWins / pairPicks
Pair Synergy = Pair WR - (Effective WR_i + Effective WR_j) / 2
```

Pair contribution is weighted by its sample size using:

```text
pairWeight = ln(1 + pairPicks)
```

The build-level Synergy is the weighted average of valid pairs. Missing pairs are excluded rather than treated as zero:

```text
Synergy =
  Σ(Pair Synergy × pairWeight) / Σ(pairWeight)
```

Synergy is stored as a ratio and displayed in percentage points. For example, `0.018` is shown as `+1.8%`.
If no valid pair is available, Synergy is `0%`.

The project uses the arithmetic mean of the two individual Effective WR values. It does not use Windrun's alternative geometric-mean presentation for this recommendation metric.

## Avg Pick #

`Avg Pick #` uses `avgPickPosition`, not `picks` and not a percentage:

```text
Avg Pick # =
  Σ(avgPickPosition_i) / number of valid abilities
```

The value is displayed with one decimal place. A smaller value means players tend to select the ability earlier. The intended range is 1 to 50.

Only abilities with a valid `avgPickPosition` participate. If no valid position exists, the fallback is `50`.

## Score

Windrun does not provide a single score matching this project's four-ability recommendation. The project therefore defines its own score:

```text
Score = Ability WR × 100 + Synergy × 100 + Ultimate Penalty × 100
```

The current ultimate penalty is:

```text
Ultimate Penalty = -0.09  when the build contains more than one ultimate
Ultimate Penalty =  0     otherwise
```

This makes a build's score primarily reflect its smoothed Ability WR, with pair synergy expressed in percentage-point scale and a usability penalty for multiple ultimates.

`Score` is a project ranking value, not a Windrun metric and not a guaranteed win probability.

## UI Metrics

Each recommendation card displays:

- `Score`: project ranking score.
- `Ability WR`: weighted smoothed single-ability win rate.
- `Synergy`: weighted pair synergy, shown as percentage points.
- `Avg Pick #`: average Windrun pick position; lower is earlier.

Sample confidence was previously shown in the card, but it is currently hidden because the displayed values were not useful for users. Sample counts still participate in WR weighting and pair weighting.

## Supplementary Windrun Metrics

### Ability Valuation

Windrun's Ability Valuation describes whether an ability is picked earlier or later than its win-rate performance would suggest:

- Positive: picked later than its performance suggests; potentially undervalued.
- Negative: picked earlier than its performance suggests; potentially overvalued.
- Near zero: pick timing is close to the expected position for its performance.

The current recommendation page does not yet expose this field. It should be added as a separate ability-level metric rather than folded into `Ability WR` or `Avg Pick #`.

### Expected Scepter / Shard

On Windrun role-analysis pages, expected item values are cumulative pickup rates:

```text
Expected Scepter = Σ Scepter pickup rate for eligible abilities
Expected Shard   = Σ Shard pickup rate for eligible abilities
```

Only abilities with the corresponding upgrade are included. The current local snapshot does not retain these upgrade pickup-rate fields, so these metrics are not currently calculated or displayed.

## Data Refresh

Refresh the Windrun snapshot with:

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
```

Then validate the implementation with:

```sh
npm test
npm run build
```

After a data refresh, verify that every `abilityStats` entry has a numeric `avgPickPosition` in the expected 1 to 50 range before using it in production recommendations.
