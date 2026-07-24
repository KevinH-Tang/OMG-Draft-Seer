# Ability Draft 多玩家策略树

> 状态：运行时实现中。本文记录共享卡池、10 人蛇形选取、全玩家策略排序、每步 Top20
> 候选和完整 1/3/1 评分；它不改变 `recommendBuilds` 的五 Pick 评分口径。

## 1. 问题边界

Dota 2 Ability Draft 不是把一个五 Pick 构筑放在真空中评分。10 名玩家从同一个候选池中
依次选取，每个玩家的选择都会让其他玩家失去一个候选。因此，“这个技能和我的技能是否
匹配”之外，还必须回答“轮到我时这个技能是否还在池中”。

当前应用的 `src/core/recommendation.ts` 解决的是单个玩家的完整构筑搜索：

```text
1 hero + 3 abilities + 1 ultimate
```

它会计算 Base、Pair 和 Triple 的评分，但不会消耗共享候选池，也不会模拟另外 9 名玩家的
选择顺序。多玩家策略树应作为一个新的状态层，复用现有的 tier 和 Pair 评分，而不是把
当前的五 Pick 搜索直接当成全桌 draft 模拟。

第一版的范围固定为：

- 10 名玩家、5 轮、每人每轮选一次。
- 选取顺序为蛇形顺序：奇数轮 `P1 -> P10`，偶数轮 `P10 -> P1`。
- 每个玩家都可以配置 `tier-first` 或 `pair-first`；不再把 P1 当作唯一目标视角。
- 每个全局位置都计算该玩家的合法候选 Top20，Top1 才是确定性模拟实际采用的选择。
- 玩家之间的策略映射通过 `strategyByPlayer` 传入；统一全 Tier、统一全 Pair 和混合位置策略
  都是同一套模拟器的输入。
- 相同的初始池、策略映射和 mask 规则形成一个可复现的全桌路径；需要比较两种策略时，
  应使用相同的其他条件分别运行，而不是把两种策略隐式混成一个 P1 特例。

第一版不声称复原真实对手行为。Windrun 快照当前只有单技能、Pair、Triple 的聚合统计，
没有每局完整的 50 手序列，也没有按玩家、轮次或位置条件化的统计。因此 mask 是显式的
启发式假设，结果应称为策略模拟或候选池模拟，而不是实际对手选择的预测。

## 2. 轮次和选取位置

全局选取编号从 `1` 到 `50`。令 `r` 为轮次，`offset` 为该轮内从 `0` 开始的位置：

```text
r = floor((globalPick - 1) / 10) + 1
offset = (globalPick - 1) % 10

player = r 为奇数 ? offset + 1 : 10 - offset
playerPick = r
```

`playerPick` 只表示该玩家的第几手，不表示对手 mask 只能选择某一种类别。对手每一手的
共享 mask 候选池都是 `all`：

```text
all = remaining heroes + remaining abilities + remaining ultimates
```

当前推荐器的 `1 hero + 3 abilities + 1 ultimate` 是一个独立的五 Pick 构筑评分形状，不能
把 round 1 到 round 5 推导成固定的类别序列。每个玩家在当前手只受自己尚未完成的类别配额
约束；候选集合仍来自 `all`，因此 hero、ability 和 ultimate 会在同一位置参与竞争。

### 十个玩家的完整 position table

下表是蛇形顺序的规范 position table。表内数字是全局 `pos`，每一列是该玩家自己的第几手；
代码测试和状态转换应以此表为固定行为基准。

| Player | Pick1 / Round1 | Pick2 / Round2 | Pick3 / Round3 | Pick4 / Round4 | Pick5 / Round5 |
| ------ | -------------: | -------------: | -------------: | -------------: | -------------: |
| P1     |           pos1 |          pos20 |          pos21 |          pos40 |          pos41 |
| P2     |           pos2 |          pos19 |          pos22 |          pos39 |          pos42 |
| P3     |           pos3 |          pos18 |          pos23 |          pos38 |          pos43 |
| P4     |           pos4 |          pos17 |          pos24 |          pos37 |          pos44 |
| P5     |           pos5 |          pos16 |          pos25 |          pos36 |          pos45 |
| P6     |           pos6 |          pos15 |          pos26 |          pos35 |          pos46 |
| P7     |           pos7 |          pos14 |          pos27 |          pos34 |          pos47 |
| P8     |           pos8 |          pos13 |          pos28 |          pos33 |          pos48 |
| P9     |           pos9 |          pos12 |          pos29 |          pos32 |          pos49 |
| P10    |          pos10 |          pos11 |          pos30 |          pos31 |          pos50 |

每个玩家的五手位置都必须从这张表读取，不能把任何玩家的五手排列成连续时间点。比如 P1
是 `pos1/pos20/pos21/pos40/pos41`，P10 是 `pos10/pos11/pos30/pos31/pos50`。
玩家之间共享同一候选池，因此任意位置的候选排序都必须基于该位置之前已经发生的消耗。

### 全局位置与 Top20

`avgPickPosition` 是快照中的历史平均全局位置，不能直接当作当前局的可用性概率。当前局的
硬可用性始终由 `DraftState.remainingByCategory` 决定；平均位置只作为候选特征、抢牌压力提示
或稳定 tie-break。

每个全局位置 `t = 1..50` 生成一份排序结果：

```text
legalRemaining(state_t, turnAt(t))
  -> calculateCandidateFeatures(...)
  -> sortBy(strategyByPlayer[turn.player])
  -> take(20)
```

Top20 是候选列表宽度，不是“未来 20 个位置”的替代品。P1 从 `pos1` 到 `pos20` 之间有 18
个对手选择，P10 从 `pos10` 到 `pos11` 之间没有对手选择；这些差异由 turn generator 和
mask 推进处理，而不是由 `topK = 20` 推导。Top1 用于确定性 replay，Top2 到 Top20 用于
解释、比较和未来 beam search。

在初始候选池为 `12 heroes + 36 abilities + 12 ultimates` 时，50 手结束后总共剩余 10 个
候选。由于每次 mask 都从 `all` 中选择，剩余的 hero、ability 和 ultimate 数量取决于实际
被选中的 ID，不能预先写成 `2/6/2`。

## 3. 核心状态

推荐使用不可变的纯数据状态，所有策略和 mask 都只产生新状态。概念类型如下：

```ts
type StrategyId = 'tier-first' | 'pair-first'
type MaskPolicyId = StrategyId

interface DraftTurn {
  globalPick: number
  round: 1 | 2 | 3 | 4 | 5
  player: number
  playerPick: 1 | 2 | 3 | 4 | 5
  selectionPool: 'all'
}

interface DraftState {
  nextGlobalPick: number
  remainingByCategory: {
    hero: number[]
    ability: number[]
    ultimate: number[]
  }
  picksByPlayer: Record<number, number[]>
  history: DraftPickEvent[]
}

interface DraftPickEvent {
  turn: DraftTurn
  abilityId?: number
  kind: 'player-pick' | 'opponent-mask'
  policy: StrategyId | MaskPolicyId
  unresolved?: boolean
}
```

实际实现可以使用 `Set` 保存剩余池，但序列化和 `stateKey` 必须使用排序后的数组。每次
应用选择都要检查以下不变量：

1. `abilityId` 在对应类别的剩余池中。
2. `abilityId` 必须存在于 `remainingByCategory` 的并集中；选取后从且仅从它所属的类别池
   移除。
3. 同一个 ID 不会被第二次选取。
4. 每个玩家位置的候选始终来自三个类别池的并集 `all`；不能按 round 过滤类别。
5. 玩家自己的已完成类别配额只限制该玩家当前位置，不改变共享池的类别并集。
6. 运行到第 50 手后，所有玩家都有 5 手，剩余候选总数为初始总数减去 50。

截图识别出的 60 个格子在进入策略树前必须先转换成 `InitialDraftPool`。转换需要确认
所有格子，并检查类别内没有重复 ID、ID 与类别匹配、候选数量满足 `12/36/12`。有未确认
候选或重复识别时，默认阻止确定性模拟；不能把 top-1 识别结果静默当成真实卡池。

## 4. 两种玩家策略

策略决定每个玩家在自己的回合选谁。全局模拟仍然要在共享池上逐手推进；某个玩家的选择
会影响所有后续位置。为了做可复现的比较，策略映射和 mask 行为都必须显式传入，不能把
“对手”默认理解为固定的 P1 之外玩家。

### 4.1 Tier first

`tier-first` 是把 Tier 放在第一优先级的贪婪策略。所有玩家都先按自己的合法候选规则过滤，
再使用 `src/core/tiers.ts` 的全局 `all` tier list，让 hero、ability 和 ultimate 参与同一次
排序；不能为某个位置临时切换成单独类别的 tier list。

Tier-first 的确定性排序键为：

```text
1. tier rank 升序（S、A、B ...）
2. pairProfile 降序
3. individual WR 降序
4. sample count 降序
5. avgPickPosition 升序
6. ability ID 升序
```

没有 tier 统计的候选排在有统计候选之后；如果所有合法候选都没有统计，仍按 ability ID
给出稳定结果，并在结果中标记数据不足。

### 4.2 Pair first

`pair-first` 是把 Pair 放在第一优先级的贪婪策略，而不是另一套候选生成器。策略层直接使用
Pair 的原始胜率；这里按需求不对样本量做额外加权：

```text
pairValue(a, b) = pairWins(a, b) / pairPicks(a, b)
```

当前仍沿用 Pair 数据的最低记录门槛；门槛通过后，排序只看原始 Pair WR，不使用 Pair 页面
的 `Synergy` 或 true synergy。

当玩家已经有选择时，候选 `c` 的即时 Pair 价值为：

```text
pairProfile(c | ownPicks) = sort(pairValue(c, ownPick) for ownPick in ownPicks)
                           -> top 1 / top 2 / top 3
```

不能把多个 Pair WR 直接相加；`pairScore` 始终是 top-1 原始 Pair WR。第一手没有已选
Pair，使用该玩家下一次选取时仍然可能存在的候选池建立同样的画像：

```text
anchor(c) = top 1 Pair WR
            + top 2 / top 3 fallback options
            + connected option count
```

`c` 和 `survivingFutureCandidate` 必须先按该玩家的合法候选规则过滤；然后对假设的当前
选择应用直到该玩家下一次选取前的共享池 mask，再从剩余池中选择，不能把一个随后会被
其他玩家抢走的 Pair 当作 anchor。比较顺序是：

1. top-1 Pair WR（1 个百分点以内视为同一档）。
2. top-2、top-3 fallback WR 和 option count，优先保留多方向候选。
3. 单技能 raw WR 和 Tier 顺序。

两种策略使用同一份候选特征和同一组 tie-break，只交换首要字段：

```text
tier-first: tierRank -> pairProfile -> individualWR -> sampleCount -> avgPickPosition -> abilityId
pair-first: pairProfile -> tierRank -> individualWR -> sampleCount -> avgPickPosition -> abilityId
```

没有 Pair 数据的候选仍保留在排序中。对 pair-first 来说它的 `pairProfile` 是缺失值，因而
自然落到 Tier 和后续 tie-break；不再额外使用 `53%` 硬门槛或只对某一策略启用完整 Score
fallback。Triple 不参与即时 Pair 排序，继续只用于完整五 Pick 的最终评分。

## 5. 任意玩家相邻两手之间的 mask

玩家在某一手选完后，不能直接从当前池计算自己的下一手。必须先处理两个位置之间的所有
其他玩家选择。例如 P1 在全局第 1 手选完后，必须先消耗第 2 到第 19 手的 18 个选择：

```text
t=1       P1 pick1
t=2..10   Round 1: P2..P10，9 次 opponent mask
t=11..19  Round 2: P10..P2，9 次 opponent mask
t=20      P1 pick2
```

这 18 次选择都使用同一个 `all` 候选池，再按对应玩家的 `strategyByPlayer` 排序；不能因为
它发生在某个 Round 就临时限制为 hero、ability 或 ultimate。目标玩家的下一手必须从这些
选择消耗后的剩余池中计算。对于每个 mask 位置同样可以生成 Top20，但 replay 只采用该位置
策略排序后的 Top1。

`mask` 的含义是从共享剩余池中移除对手假定会拿走的 ID，而不是把一个 UI 候选按钮视觉
隐藏掉。每一个 mask 事件都必须写入 history，便于调试和解释“为什么 Pick2 不再可用”。

伪代码如下：

```ts
function advanceDraft(
  state: DraftState,
  strategyByPlayer: Record<number, StrategyId>,
) {
  while (state.nextGlobalPick <= 50) {
    const turn = turnAt(state.nextGlobalPick)
    const strategy = strategyByPlayer[turn.player] ?? 'tier-first'
    const top20 = rankDraftCandidates(state, turn, strategy).slice(0, 20)
    const abilityId = top20[0].abilityId
    state = applyPick(state, turn, abilityId, 'player-pick', strategy)
  }
  return state
}
```

实现时不应把 mask 误当成视觉隐藏。每一个全局位置都从当前共享池计算候选并写入 history；
若 `all` 已经没有候选，严格模式应使该路径无效并报告池容量错误，宽松模式可以记录
`unresolved`，但不能继续产生看似精确的确定性结论。

任意玩家后续的时间间隔都按 turn generator 推进：

- P1 的 Pick2 到 Pick3 之间没有对手手数，直接处理全局第 21 手。
- P1 的 Pick3 到 Pick4 之间处理全局第 22 到第 39 手的 18 个共享池选择。
- P10 的 Pick1 到 Pick2 之间只有一个位置间隔，直接处理全局第 11 手。

因此不能用“每个自己的 pick 后固定 mask N 张牌”的近似；mask 数量由当前玩家和蛇形轮次
共同决定。`turnAt` 是唯一的位置来源，UI 和策略层都不应复制轮序公式。

## 6. 全玩家路径和策略比较

运行时的基础路径是从 `pos1` 到 `pos50` 逐手处理：

```ts
for (const turn of buildDraftTurns()) {
  const strategy = strategyByPlayer[turn.player] ?? 'tier-first'
  const top20 = rankDraftCandidates(state, turn, strategy)
  state = applyDraftPick(
    state,
    turn,
    top20[0].abilityId,
    'player-pick',
    strategy,
  )
}
```

虽然历史上可以把“P1 的两手之间”当作一个例子，但实现不能保存 `targetPlayer` 特例。
每个玩家的候选、Pair profile、下一手位置、mask 数量和最终五手都从同一个 `DraftTurn` 状态
推导。

要比较两种策略，使用相同的 snapshot 和初始池分别运行两份策略映射，例如：

```ts
const tierScenario = Object.fromEntries(
  players.map((player) => [player, 'tier-first']),
)
const pairScenario = Object.fromEntries(
  players.map((player) => [player, 'pair-first']),
)
```

也可以传入混合映射来模拟不同位置的玩家画像，但混合映射应被明确标记为一个场景，不能
把它当作 Tier/Pairs 两种策略的直接 A/B 结果。

每个全局位置至少保存：

- `turn`、玩家编号、该玩家的个人手数和全局位置；
- 该位置采用的策略和完整 Top20 候选排序；
- Top1 的实际选择和 rationale；
- 当前剩余池数量、当前玩家已有选择和后续 history；
- 结束后每个玩家的五手构筑和现有 Base、Interaction、Score。

## 7. Top20 与未来分支

确定性 Replay 只沿每个位置的 Top1 继续，因此 50 个位置可以线性生成 50 份 Top20。Top20
列表本身不应被误解为 20 条完整路径；如果将每个位置的 20 个候选全部展开，节点数会按
`20^50` 增长。

需要探索替代路线时，只在每个玩家自己的五个决策点保留候选分支，中间的其他位置仍用
确定性策略 mask，然后在每个决策点将 beam 裁剪到固定宽度。`topK = 20` 可以作为第一版的
显示宽度和 beam 候选宽度，但应在结果中标记 beam 是近似搜索。

最终五 Pick 评分继续使用当前 `recommendation-metrics.md` 的公式。Tier 和 Pair 只用于即时
候选排序、mask 和搜索裁剪，不进入最终 Score。Pair-first 的即时 Pair 值是原始 Pair WR，
完整 Score 仍按 page1 的 Base、Pair/Triple logit 公式独立计算。

## 8. 复杂度和缓存

确定性路径最多计算 `50 * 60` 个候选排序；第一手 Pair profile 还会触发到下一次该玩家
位置前的 mask 模拟，因此需要缓存 `(stateKey, globalPick, player, candidateId)` 对应的未来
状态和候选池。Top20 是排序后的切片，不能把未排序的前 20 个池元素当作候选。

实现时应：

- 按完整 `stateKey` 缓存未来 mask 状态和下一手候选池。
- 让 mask 也使用对应玩家的策略映射，但禁止递归展开完整未来树。
- 把排序结果作为 replay frame 的派生数据，不放入 `stateKey`。
- 给未来的 beam search 另设 `MAX_STRATEGY_TREE_NODES`，不要复用完整构筑组合的上限。

如果将来从“每个位置一个确定性路径”升级为“每个位置保留多个候选分支”，应先在五个
个人决策点做 beam search，并保留全局位置 history，而不是复制 50 手全桌状态树。

## 9. 推荐的代码落点

运行时实现保持核心逻辑纯函数，并按以下边界拆分：

| 模块                                             | 职责                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `src/core/draft-turns.ts`                        | 生成 50 个 `DraftTurn`，校验蛇形顺序、玩家映射和个人手数              |
| `src/core/draft-state.ts`                        | 初始池、合法性、不变量、应用选择、history 和 `stateKey`               |
| `src/core/draft-strategy.ts`                     | 共同候选特征、Top20 排序、`tier-first`、`pair-first` 和策略 tie-break |
| `src/core/draft-tree.ts`                         | 全 50 手路径、每步 Top20、mask memoization 和 replay frame            |
| `src/types.ts`                                   | 对外的 draft 状态、策略、树节点和结果类型                             |
| `src/core/recommendation.ts` 或独立 score helper | 暴露可复用的完整五 Pick 评分，不复制 Pair/Triple 公式                 |

第一阶段不需要修改 Windrun snapshot schema。初始共享池来自已确认的 60 个截图格，统计
仍来自现有 `Snapshot`。如果后续要把模拟从启发式升级为校准模型，数据同步脚本需要额外
提供每局的 draft 序列、玩家归属、选取位置和版本信息；仅增加 `avgPickPosition` 无法
支持这个目标。

## 10. 测试和验收标准

新增核心模块后，测试应覆盖行为而不是只覆盖某几个 ID：

1. turn generator 的 50 个位置必须逐项匹配上面的十玩家 position table，包括 P1 的
   `[1, 20, 21, 40, 41]` 和 P10 的 `[10, 11, 30, 31, 50]`；round 只决定玩家和个人手数，
   不决定类别。
2. 每个全局位置都基于当时的共享池生成 Top20；Top1 被消耗后，下一位置不能再看到它。
3. Tier-first 和 Pair-first 使用相同候选集合、同一组 tie-break，只交换 Tier/Pair 的主次。
4. 10 个玩家分别运行五手后，所有玩家都有完整 1/3/1 构筑，且 50 个 ID 不重复。
5. P1、P10 和中间位置的下一手都正确处理不同数量的共享池消耗。
6. `pair-first` 在可靠 Pair、无 Pair 数据和全零 Pair 时不产生额外的隐藏阈值分支。
7. 相同 snapshot、初始池和策略映射重复运行得到完全相同的 history、Top20 和最终结果。

在 UI 验收时，应能切换或识别所有玩家位置的策略，看到当前全局位置的 Top20、已消耗池、
玩家归属和最终五手；不能只显示一个没有时序来源的“P1 Pick2 推荐”。

## 11. 当前状态和后续顺序

当前仓库已经具备 tier list、Pair/Triple 评分、60 格识别结果、五 Pick build 评分和多玩家
Draft Replay。全玩家 Top20 路径是当前实现边界；后续重点是：

1. 用真实截图池审计十个位置的 Top20 稳定性和共享池冲突。
2. 将确定性 Top1 路径扩展为可控深度的 beam search，并保持 Replay 的确定性。
3. 评估 Top20 对最终 Top1/TopN 的召回率和排序稳定性。
4. 在 UI 中继续暴露候选画像、被 mask 的组合和最终 Score，避免只显示单一推荐。

在第 4 步以前，任何界面文案都应明确这是单人五 Pick 推荐或实验性策略模拟；不能宣称
已经预测了真实 9 名对手的选择。
