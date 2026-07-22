# 构筑 Score 计算规则

> 本文描述当前推荐器的实现口径。`Tier List` 和 `Ability Pairs` 页面有独立的展示排序；它们不直接改变构筑卡的 Score。

## 目标与范围

推荐器只生成满足以下结构的五 Pick 构筑：

```text
1 个英雄 + 3 个普通技能 + 1 个终极技能
```

Score 的目标是为候选构筑提供保守、可解释的排序信号，而不是声称给出该五技能组合的真实观测胜率。单技能、Pair 和 Triple 统计均来自同一份本地 Windrun 快照。

实现位置：

- `src/core/recommendation.ts`：构筑枚举、Score 和互动选择。
- `src/core/pairs.ts`：Pair/Triple 键和本地统计索引。
- `src/App.tsx`：构筑卡及互动悬停详情。
- `public/data/snapshots/latest.json`：运行时快照。

所有计算使用 `0` 到 `1` 的比率，界面再格式化为百分比。

## 输入数据

| 本地字段 | 含义 | Score 中的用途 |
| --- | --- | --- |
| `abilityStats[].picks` | 单技能样本量 | 单技能 WR、互动置信度 |
| `abilityStats[].wins` | 单技能胜场 | 单技能 WR、互动基线 |
| `abilityStats[].avgPickPosition` | 平均选取顺位 | 仅展示 `Avg Pick #` 和 Pick 顺序 |
| `pairStats[].picks/wins` | 两技能共同出现的样本和胜场 | Pair 互动 |
| `tripletStats[].picks/wins` | 三技能共同出现的样本和胜场 | Triple 互动 |

若同一 Pair 或 Triple 有重复记录，使用样本量较大的一条。缺少有效单技能统计的技能在 `Win Rate` 中按 `50%` 处理，但不能参与互动计算。

## 基础 Win Rate

对五个技能分别计算原始胜率：

```text
WR_i = wins_i / picks_i
```

构筑卡中的 `Win Rate` 是五项的简单算术平均：

```text
Base WR = (WR_1 + WR_2 + WR_3 + WR_4 + WR_5) / 5
```

它不按样本量加权，也不使用 Tier、平均 Pick 顺位或技能价值。目的是让 Score 的基础项与每个 Pick 一一对应并且易于核对。

## 原始互动增益

只有样本量不少于 50 的 Pair 或 Triple 可以作为候选互动：

```text
groupPicks >= 50
```

对于包含 `k` 个技能的互动组 `g`，先计算该组的观测胜率与单技能基线：

```text
Group WR_g = groupWins_g / groupPicks_g
Baseline_g = Σ(WR_i) / k
Raw Synergy_g = Group WR_g - Baseline_g
```

因此：

```text
Pair Raw Synergy   = Pair WR - (WR_i + WR_j) / 2
Triple Raw Synergy = Triple WR - (WR_i + WR_j + WR_k) / 3
```

`Raw Synergy` 仅表示当前快照中的未经收缩差值，不会直接相加到 Score。多个 Pair 往往复用同一个技能，直接求和会把同一效果重复计算。

## 置信度收缩

每个候选互动会根据其观测样本和单技能样本计算标准误：

```text
SE_g = sqrt(
  Group WR_g * (1 - Group WR_g) / groupPicks_g
  + Σ(WR_i * (1 - WR_i) / picks_i) / k^2
)
```

采用 `1.96` 的 95% 置信度收缩：

```text
Reliable Synergy_g = sign(Raw Synergy_g)
  * max(0, abs(Raw Synergy_g) - 1.96 * SE_g)
```

这会将低样本或不显著的差值收缩到 `0`。当前 Score 只把 `Reliable Synergy > 0` 的互动作为正向候选；负向或不显著互动不会提供加分，也不会另行施加惩罚。

## 独立互动覆盖

推荐器不会累加全部 Pair。它在五个已选技能上枚举可信的 Pair 和 Triple，然后选取总 `Reliable Synergy` 最大的一组不重叠互动：

```text
同一技能最多属于一个计分互动组
```

因此，一套五技能构筑最多出现以下两种覆盖：

```text
2 个 Pair + 1 个未参与互动的技能
1 个 Triple + 1 个 Pair
```

也允许只选到一个互动组，或没有互动组。若选中了 Triple，任何与它共享技能的 Pair 都不能同时计分，Triple 因而会替代其内部或相邻的 Pair 证据。未被选中的 Pair 仍可作为数据库浏览信息，但不会出现在构筑卡的 `Synergy` 合计中。

## Score

最终 Score 为基础 Win Rate 加上独立互动覆盖的可信增益，并限制在合法百分比范围内：

```text
Interaction Bonus = Σ(Reliable Synergy_g for selected non-overlapping groups)

Score = clamp(Base WR + Interaction Bonus, 0, 1) * 100
```

`Score` 以百分比展示，仍是项目定义的预测性排序指标，不是 Windrun 官方指标，也不是该五技能组合的保证胜率。

Tier 仅用于候选技能的排序、徽标和过大候选池的短名单优先级，不参与上述 Score 公式。`Avg Pick #` 仅用于展示实际 Pick 顺序和平均顺位。

## 示例

以下是一次以本地 `latest.json` 复算的示例，数据刷新后数值可能变化：

```text
Base WR = 52.6%

Doom + Corrosive Skin
  Raw Synergy:      +5.1pp
  Reliable Synergy: +1.1pp

Blade Fury + Pulse Nova
  Raw Synergy:      +9.8pp
  Reliable Synergy: +6.0pp

Interaction Bonus = +7.1pp
Score = 52.6% + 7.1pp = 59.7%
```

旧模型会将六条互相共享技能的 Pair 直接累加为 `+36.4pp`，给出 `89.0%`。独立互动覆盖只计入两组不重叠、通过置信度收缩的证据，避免重复计分。

## 构筑卡展示

每张推荐卡显示：

- `Score`：经边界限制后的最终排序值。
- `Win Rate`：五个 Pick 的基础 WR。
- `Synergy`：已选独立互动组的可信增益，以及“有效 X 组”。
- `Avg Pick #`：五个技能的平均 `avgPickPosition`，数值越小表示通常被更早选取。

悬停或键盘聚焦 `Synergy` 会显示每个实际计分的 Pair/Triple 图标；原始增益与样本量显示在互动项的提示信息中。

## 验证与数据刷新

刷新数据后依次运行：

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
```

然后验证推荐逻辑：

```sh
npm test
npm run build
```

推荐器测试覆盖构筑结构、锁定 Pick、Pair 的原始与收缩增益、不重叠互动、Triple 替代 Pair、低样本收缩，以及候选池短名单行为。
