# UI 组件库引入与改造计划

> 当前状态：`@tanstack/react-virtual`、Radix Tooltip/Alert Dialog 与 Sonner 已在 `App.tsx` 落地。本文保留为采用决策和后续拆分记录，不是待执行清单；`AbilityPairsTable` 组件抽取尚未实施。

> 状态：第 2 至 4 页的首批改造已完成；第 1 页手动候选选择和条件性的 `cmdk` 仍等待单独执行。

## 1. 目标与边界

在保留 React + Vite 浏览器调试和 Tauri 桌面壳的前提下，局部采用以下库：

- `@tanstack/react-virtual` 降低 Ability Pairs 虚拟列表的维护成本。
- Radix UI primitives 解决浮层定位、焦点管理、确认操作和图标按钮提示。
- Sonner 统一短暂操作反馈。
- `cmdk` 仅在人工校正需要检索完整技能库时引入。

本轮不采用 Radix Themes，不替换全局 CSS，不重写已有页面标签页，也不将 UI 库用于开发者专属功能。领域逻辑继续位于 `src/core/`，平台适配继续位于 `src/platform/`；上述依赖只进入 React 展示层。

所有前端依赖均应在浏览器 `npm run dev` 和桌面 `npm run desktop:dev` 中运行。TSX/CSS 修改继续由 Vite 热更新；只有 Tauri/Rust 依赖或 capability 变更才需要重启桌面壳。本计划不涉及 Tauri 插件，因此不新增 Rust crate 或 capability 权限。

## 2. 采用总览

| 库 | 首个应用区域 | 预期收益 | 是否立即执行 |
| --- | --- | --- | --- |
| `@tanstack/react-virtual` | `src/App.tsx` 的 Ability Pairs 表格 | 删除手写窗口计算，稳定维护固定高度虚拟行 | 是 |
| Radix `Popover` | 截图分析页的手动候选技能浮层 | 自动避让、关闭和焦点处理 | 是 |
| Radix `AlertDialog`、`Tooltip` | 重置布局确认、图标按钮提示 | 减少破坏性误操作，统一无障碍行为 | 是 |
| Sonner | 布局导入/导出/重置与识别完成等短暂结果 | 反馈更及时一致，减少瞬时状态残留 | 是 |
| `cmdk` | 手动校正时搜索完整技能库 | 在候选不充分时快速定位合法技能 | 条件执行 |

当前的 Pair 表格已经通过 `pairVirtualWindow`、上下 spacer 行实现虚拟滚动。因此 TanStack Virtual 的首要价值是代码整洁和边界情况可靠性，不应承诺会带来数量级的性能提升。筛选和排序仍会处理完整的 `filteredPairEntries`；若输入搜索仍慢，应独立测量并优化筛选/排序，而不是归因于虚拟列表。

## 3. `@tanstack/react-virtual`

### 应用区域

仅替换 `src/App.tsx` 中 Ability Pairs 页面：

- `pairScrollTop`、`pairViewportHeight` 状态。
- `pairTableRef` 的尺寸监听和滚动复位。
- `pairVirtualWindow` 与 `visiblePairEntries` 计算。
- `<tbody>` 中的上下 spacer 行。

保留搜索、同英雄排除、排序、表头、列宽、数据格式化和当前视觉样式。Tier List 目前不是长行式滚动表格，不纳入第一阶段。

### 修改方案

1. 安装 `@tanstack/react-virtual`，锁定 lockfile；不新增 Tauri 依赖。
2. 将 Pair 表格提取为 `src/components/AbilityPairsTable.tsx`。父组件继续计算并传入已筛选、已排序的 `AbilityPairEntry[]`、当前排序状态及排序回调，避免改变推荐和数据计算逻辑。
3. 在表格滚动容器上使用 `useVirtualizer`：`count` 为已筛选结果数量，`getScrollElement` 指向现有 `.pairs-table-scroll`，`estimateSize` 为当前 `PAIR_ROW_HEIGHT`，`overscan` 初始设为 8。
4. 保留语义化 `<table>`、`<thead>` 和现有 sticky 表头。`<tbody>` 继续以首尾占位行承载不可见区域，但高度完全由 virtualizer 的 virtual item 起止位置计算；不再保留人工计算的表头高度、滚动状态或可见窗口。
5. 继续使用固定 52px 行高。若隐藏三元组内容使行高不再固定，再为该行接入 `measureElement`；不要在尚未出现动态行高前提前增加测量逻辑。
6. 筛选条件、排序条件变动后调用 `virtualizer.scrollToOffset(0)`，确保行为与当前回到表头一致。

### 验收与风险

- 搜索、切换“Exclude Same Hero”、每个排序按钮后均回到第一行，结果、顺序和行数与改造前一致。
- 快速滚动到末尾、再改变筛选条件时不出现空白区、重叠行或错误的滚动高度。
- 表头持续固定，窄窗口横向滚动时列宽与现有页面一致。
- 初始可见 DOM 行数只随视口和 overscan 变化，不随总 Pair 数量线性增加。
- 用真实最大数据快照记录筛选、排序和滚动的性能基线；若瓶颈是完整数组的过滤和排序，另开任务处理，不能扩大本次改造范围。

## 4. Radix UI primitives

仅安装所需单包：`@radix-ui/react-popover`、`@radix-ui/react-alert-dialog` 与 `@radix-ui/react-tooltip`。不安装 Radix Themes，也不将目前已可访问的页面标签页迁移到 `Tabs`。

### 4.1 手动候选技能：`Popover`

**应用区域：** 截图分析页的 `.manual-candidates-floating`。当前实现依赖 `getBoundingClientRect()`、固定坐标、window scroll/resize 监听和 input blur 延时关闭。

**修改方案：**

1. 新建 `src/components/ManualCandidatePicker.tsx`，每个技能格持有一个受控 `Popover.Root`；触发器保留原有图标、名称和“已确认”视觉。
2. 以当前选择的技能名或首选识别结果作为触发器文本，候选项仍只显示该格已有的 OCR 候选及排名。
3. `Popover.Content` 使用 `side="bottom"`、碰撞避让和视口边距；内容以 portal 渲染，复用 `.manual-candidates` 与 `.manual-candidate` 的配色，不保留 `position: fixed` 坐标计算。
4. 选择候选后调用现有 `updateSlot`，随后关闭 Popover；点击外部、Esc、滚动和窗口尺寸改变由 Radix 处理。
5. 删除 `manualPickerPosition`、`openManualPicker`、`openManualPickerFromLabel`、`scheduleManualPickerClose` 及其 scroll/resize effect。若只需全局关闭状态，保留精简后的 `manualSlotIndex`；否则将 open state 下沉到 picker 组件。

**验收：** 鼠标、Tab、Enter、Esc 都能可靠打开/关闭和选中；浮层在页面边缘不被裁切；选择后焦点回到对应触发器；桌面 WebView 与浏览器行为一致。

### 4.2 布局重置：`AlertDialog`

**应用区域：** Layout Analysis 的 `Reset` 按钮。该操作会清除三项本地布局存储并恢复默认布局。

**修改方案：** 将现有按钮作为 `AlertDialog.Trigger`，在确认内容中说明会清除导入布局和手动微调；确认按钮才调用现有 `resetLayout`，取消按钮不改变状态。现有 `Load layout`、`Save layout` 继续使用浏览器 `File`/`Blob` 适配器，不接入原生对话框。

**验收：** Esc、点击遮罩和取消均不清除存储；确认后界面回到默认布局且返回原触发器焦点。

### 4.3 图标按钮与 Tier 技能详情：`Tooltip`

**应用区域：** 校准开关等仅图标操作，以及 Tier List 的技能详情。当前 `title` 保留为无脚本回退，但由 Tooltip 提供一致的 hover/focus 提示；Tier 卡片改用 Portal 内容避免被列表边界裁切。

**修改方案：** 在页面根部放置一个 `Tooltip.Provider`，局部包装现有 `.icon-command`；不改变按钮尺寸、图标、颜色和现有 `title` 文案。Tier 卡片的统计浮层迁移到 `Tooltip.Content`，保留当前信息层级与配色，并使用碰撞避让保证边缘卡片可见。

## 5. Sonner

### 应用区域

Sonner 只处理用户操作已经结束、无需长期占位的结果：

- 布局 JSON 成功载入。
- 布局 JSON 导出已触发。
- 用户确认重置后已恢复默认布局。
- 截图识别成功并产生候选格。
- 用户手动确认某个候选技能。

### 修改方案

1. 安装 `sonner`，在 `App` 根部仅渲染一个 `<Toaster>`，并按当前深色绿色界面调整其 CSS variables；不使用渐变或大面积圆角卡片风格。
2. 在上述成功回调中直接调用 `toast.success`，初始时长统一为 3 到 4 秒，同屏最多显示 3 条。
3. 对“上传文件无效”“识别失败/超时”“布局文件无效”等一次性操作错误调用 `toast.error`。
4. 保留现有 `error` inline notice，用于快照加载失败、签名库加载失败、运行环境能力缺失等持续影响功能的状态。不要把持久性故障只放进会自动消失的 toast。
5. 不在 `src/core/`、`src/workers/` 或 `src/platform/` 中直接导入 Sonner。领域和平台层只返回数据或错误，React 事件处理器决定如何呈现反馈。

### 验收

- 用户触发的成功和失败都有即时反馈，但页面上不会积累历史通知。
- 资源降级和能力缺失仍有可见的长期提示。
- 连续重新切分不会产生过多重复 toast；旧识别请求的回调不得显示成功或失败通知。

## 6. `cmdk`（条件项）

### 触发条件

当前候选浮层只展示该格 OCR 返回的候选，数量有限，因此不立即安装 `cmdk`。只有产品确认“人工校正可以在完整技能库中搜索，而不局限于 OCR top-N 候选”时才进入本节。

### 应用区域与修改方案

1. 在 `ManualCandidatePicker` 底部提供“搜索全部可用技能”命令；点击后打开 `Command.Dialog`，不注册全局 `Ctrl+K`，避免劫持浏览器查找和桌面快捷键。
2. 搜索源为当前 `snapshot.abilities`，匹配 `name` 与 `shortName`。根据当前格类别过滤：英雄格仅英雄技能，普通格仅普通技能，终极格仅终极技能；过滤逻辑复用现有 `isHeroAbility` 和能力分类规则，不在组件内重复定义。
3. 命令项展示技能图标、全名、短名和类别。选择后调用 `updateSlot`，关闭命令面板及其父 Popover，并恢复焦点到原技能格。
4. 没有搜索结果时显示明确空状态；搜索不应改变 Tier 和 Pair 页已有的独立筛选状态。
5. 若完整技能库扩大到数千条，再测量后考虑在命令结果内虚拟化；第一版不叠加 `@tanstack/react-virtual`，避免复合交互复杂度。

### 验收

- 只能选中与格位类别兼容的技能。
- 键盘可输入、上下移动、Enter 确认、Esc 关闭；鼠标操作等价。
- 选中后推荐候选池和推荐结果立即按现有逻辑更新。

## 7. 推荐实施顺序

1. 记录浏览器和桌面基线：Ability Pairs 筛选/排序、手动候选选择、布局导入导出重置、截图识别。
2. 引入 `@tanstack/react-virtual` 并单独完成 Pair 表格替换与验证。
3. 引入 Sonner，先接入布局操作和识别完成通知，保留持久性 inline notice。
4. 引入 Radix Popover、AlertDialog、Tooltip，按 4.1 至 4.3 的顺序替换。
5. 由产品确认完整技能库搜索后，再安装并实现 `cmdk`。

每一阶段单独提交，并至少运行 `npm test`、`npm run build`、`npm run dev` 的浏览器手工验收和 `npm run desktop:dev` 的桌面手工验收。UI 组件交互测试应在项目引入 `@testing-library/react`、`@testing-library/user-event` 与 `jsdom` 后补充；在此之前，执行上述明确的手工验收项。

## 8. 回滚与暂停条件

- 任何阶段若改变识别、布局 JSON、推荐结果或本地存储格式，立即停止并拆分问题；这些不属于 UI 库改造的预期影响。
- 若虚拟表格破坏语义、表头或窄窗口布局，恢复现有 spacer 实现，不在同一任务中重构 Pair 页面其他部分。
- 若 Popover 在目标 WebView 中存在焦点或定位异常，先保留现有浏览器实现并记录复现条件，不引入原生插件作为替代方案。
- 若 `cmdk` 无法证明能减少人工校正操作，不执行该条件项。
