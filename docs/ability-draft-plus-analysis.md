# Ability Draft Plus 项目分析

> 外部项目分析，不描述 OMG-Draft-Seer 的当前实现。本文涉及的 Electron、ONNX、SQLite、游戏 Overlay、窗口跟踪和 IPC 均不在本仓库中；仅可作为未来能力评估的参考。

## 项目信息

- 被分析项目绝对路径：`D:\workspace\ability-draft-plus`
- 分析版本：v2.0.2，当前 `main` 分支
- 分析性质：基于源码、项目文档、测试目录和构建配置的静态分析

## 总体评价

这是一个架构质量明显高于普通个人 Electron 项目的 Dota 2 Ability Draft 辅助工具。它已经形成了从游戏截图、机器学习识别、本地统计数据到游戏内 Overlay 推荐的完整产品链路。

主要问题不在代码组织，而在功能完成度和边界场景：部分功能只完成了 IPC 类型或前端入口，没有真正接通；ML Worker 并发控制、窗口坐标体系和数据刷新事务性也存在风险。

## 优点

### 1. 分层和依赖边界清晰

- `src/core` 不依赖 Electron，评分、扫描处理、数据库仓储、分辨率算法和数据转换都可以独立测试。
- `src/main` 负责窗口、数据库、ML、抓取和 IPC 编排，`src/renderer` 负责控制面板和 Overlay UI。
- 使用工厂函数和依赖注入，降低了核心逻辑对运行环境的耦合。
- IPC 通道有集中类型定义，减少了渲染进程和主进程之间的接口漂移。

参考：`D:\workspace\ability-draft-plus\docs\ARCHITECTURE.md`、`D:\workspace\ability-draft-plus\src\shared\ipc\api.ts`

### 2. 产品闭环完整

- 内置 ONNX 模型和本地 SQLite 数据库，运行时不依赖额外后端。
- Windrun JSON API 提供英雄、技能、组合和三元组合统计。
- 扫描结果会经过识别、数据库 enrichment、评分、OP/Trap 过滤和 Overlay 展示。
- 支持初次扫描和已选技能的再次扫描，符合 Ability Draft 的实际流程。

### 3. Overlay 工程实现较成熟

- 支持透明、置顶、鼠标穿透和交互元素临时接管鼠标。
- 支持窗口化游戏的窗口跟踪和 Overlay 重定位。
- 支持预设分辨率、自适应缩放、自定义布局和四点校准。
- 使用 `showInactive()`，避免激活 Overlay 时抢走游戏焦点。

参考：`D:\workspace\ability-draft-plus\src\main\services\window-manager.ts`、`D:\workspace\ability-draft-plus\src\main\services\window-tracker-service.ts`

### 4. ML 处理路径设计合理

- 使用 INT8 MobileNetV2，模型体积和推理资源占用较低。
- 使用 Worker Thread，避免 ONNX 推理阻塞 Electron 主进程。
- 支持批量裁剪、预处理、置信度过滤和未知技能回退。
- 通过 `class_names.json` 和数据库名称比对，能够发现模型与统计数据之间的名称漂移。

### 5. 工程化能力比较完整

- 有日志、可选 Sentry、自动更新、启动备份、手动备份/恢复和国际化。
- 测试覆盖领域逻辑、数据库仓储、抓取转换、分辨率算法、ML 预处理和部分 Overlay Hook。
- CSP、`contextIsolation` 和 `nodeIntegration: false` 等 Electron 安全配置已启用。

## 缺点和风险

### 1. 高优先级：反馈功能没有真正接通

前端会发送以下消息：

- `feedback:takeSnapshot`
- `feedback:exportSamples`
- `feedback:uploadSamples`

但 `src/main/ipc` 中没有对应的 `ipcMain.on` 处理器，也没有反馈服务注册逻辑。因此覆盖层的“报告识别失败”、设置页的样本导出和上传按钮不会产生实际效果，属于文档/界面承诺与实现不一致。

参考：

- `D:\workspace\ability-draft-plus\src\renderer\overlay\src\App.tsx:95`
- `D:\workspace\ability-draft-plus\src\renderer\control-panel\src\components\settings\feedback-card.tsx:42`
- `D:\workspace\ability-draft-plus\src\shared\ipc\api.ts:106`

### 2. 高优先级：ML Worker 的并发和生命周期管理不安全

`ml-service.ts` 只保存一个全局的 `initResolve/initReject` 和一个全局的 `scanResolve/scanReject`，没有请求 ID，也没有扫描队列。

可能出现的问题：

- 两次扫描同时发生时，后一次请求会覆盖前一次请求的回调。
- 扫描超时的定时器可能影响后续扫描。
- 自动初始化尚未完成时，用户点击重试或发起扫描，可能创建多个 Worker。
- 初始化失败后，旧 Worker 可能没有被释放。

参考：`D:\workspace\ability-draft-plus\src\main\services\ml-service.ts:109`

### 3. 中高优先级：扫描后处理失败可能让 UI 卡在扫描状态

ML 原始结果发送成功后，才会进入 `ScanProcessingService` 的数据库查询和推荐计算。如果 enrichment 或数据库查询失败，当前实现只记录日志，不向 Overlay 发送错误事件。

前端只有收到 `overlay:data` 后才会从 `scanning` 进入 `scanned`，因此这种失败可能表现为：界面一直显示扫描中，用户没有明确错误信息。

参考：

- `D:\workspace\ability-draft-plus\src\main\ipc\ml-handlers.ts:127`
- `D:\workspace\ability-draft-plus\src\main\services\scan-processing-service.ts:103`

### 4. 中优先级：DirectML 文档承诺与生产实现不一致

分类器本身支持 `useDirectML`，但生产初始化固定传入 `false`，当前实际使用 CPU：

`D:\workspace\ability-draft-plus\src\main\services\ml-service.ts:149`

因此 README 和架构文档中的“DirectML GPU 加速”目前只是预留能力，不是实际默认能力，也没有用户可见的启用设置。

### 5. 中优先级：截图预取功能没有被启用

`ScreenshotService` 实现了 `startPrefetch()`，但项目中没有调用它；扫描和校准截图还都使用 `capture(true)` 强制重新截图。

因此文档中描述的预取优化当前不会生效。

参考：

- `D:\workspace\ability-draft-plus\src\main\services\screenshot-service.ts:51`
- `D:\workspace\ability-draft-plus\src\main\ipc\ml-handlers.ts:88`

### 6. 中优先级：多显示器和 DPI 场景较脆弱

实现大量依赖 `screen.getPrimaryDisplay()` 和主显示器 DPI，同时通过固定标题 `Dota 2` 查找游戏窗口。

潜在影响包括：

- 游戏运行在副屏时，Overlay 初始位置和截图来源可能不一致。
- 不同显示器 DPI 下，物理像素到逻辑像素的换算可能错误。
- 游戏标题变化、窗口化边界或特殊启动参数可能导致窗口找不到。
- 窗口跟踪间隔为 2 秒，移动或调整窗口时存在明显延迟。

参考：`D:\workspace\ability-draft-plus\src\main\services\window-tracker-service.ts:105`、`D:\workspace\ability-draft-plus\src\main\ipc\index.ts:110`

### 7. 中优先级：自动缩放只是近似算法

项目文档强调非标准分辨率可以自动缩放，但源码注释和测试已经承认，极端分辨率下英雄位置可能出现几十像素误差，且某些超宽分辨率不能按统一比例缩放。

技能图标位置通常更准确，但英雄模型和操作按钮仍可能偏移。实际产品应把自动缩放明确标为“尝试匹配”，并在检测到误差风险时优先提示校准。

参考：`D:\workspace\ability-draft-plus\src\core\resolution\scaling-engine.ts:1`

### 8. 中优先级：数据更新缺少事务保护

抓取流程先写入英雄和技能，再清空并重建技能组合、英雄组合和三元组合。如果第二阶段请求失败或写入中断，数据库可能保留部分新数据和部分旧数据，导致推荐结果不一致。

组合仓储的 `clearAndInsert*` 方法是先删除再逐条插入，也没有跨表事务或临时数据库替换。

参考：

- `D:\workspace\ability-draft-plus\src\core\scraper\orchestrator.ts:96`
- `D:\workspace\ability-draft-plus\src\core\database\repositories\synergy-repository.ts:360`

### 9. 中低优先级：推荐模型的统计假设比较简单

推荐分数主要是：

`0.4 * 胜率 + 0.6 * 平均选取位置`

它没有显式考虑样本量、数据版本、置信区间、玩家水平、技能语义或当前版本机制变化。模型本身只负责识别图标，推荐质量完全依赖 Windrun 数据和固定阈值，可能出现统计上高分但实战适配性一般的结果。

参考：`D:\workspace\ability-draft-plus\src\core\domain\scoring.ts`

## 建议的改进顺序

1. 补齐反馈 IPC，并为截图保存、导出和上传增加端到端测试。
2. 将 ML 请求改为带请求 ID 的状态机，或至少对初始化和扫描增加互斥队列、取消和完整 Worker 清理。
3. 把扫描后处理错误显式推送给 Overlay，避免 UI 无限停留在扫描中。
4. 使用临时数据库或事务完成抓取后再整体替换，避免刷新中断破坏现有统计数据。
5. 明确 DirectML 实际支持范围，增加配置入口；启用或删除未使用的截图预取功能。
6. 增加多显示器、不同 DPI、窗口移动、Overlay 交互和真实 Electron 打包后的 E2E 测试。

## 结论

项目的基础架构、模块边界和产品思路是优点，适合继续迭代；当前最需要解决的是“功能声明已经存在，但实现链路未闭合”的问题，以及 ML、坐标和数据刷新这三个高风险边界。完成上述改进后，项目的可靠性会比继续增加推荐功能更值得优先投入。
