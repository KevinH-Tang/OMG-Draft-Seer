# OMG-Draft-Seer

I'm a beacon of synergy, blazing out across a black sea of OMG picks.

许可证：AGPL-3.0-only，完整文本见 [`LICENSE`](LICENSE)。

本地网页工具，用于分析 Dota 2 OMG 选技截图。当前版本聚焦“布局校正 -> 图标模板匹配 -> 人工确认 -> 构筑推荐”闭环。

## 当前实现

- 默认布局基准为 `2560x1440`，上传其他分辨率时会按宽高比例缩放布局坐标。
- 候选池共 60 格：12 个英雄、36 个普通技能、12 个终极技能。
- 仍不支持不同 UI 构成、皮肤或其他游戏画面；非等比例图片可能需要重新校正布局。
- 布局不是自动检测的：需要先在网页中对齐方框，再进行裁剪和匹配。
- `Skill Analysis` 用于截图识别、人工确认和五 Pick 构筑推荐（1 英雄、3 普通技能、1 终极技能）。
- `Tier List` 使用当前快照的单技能胜率、平均选取位置和 Ability Valuation 排序。
- `Ability Pairs` 展示技能对胜率、协同以及可比较的三技能组合。
- 桌面端只支持 Windows 和 macOS；浏览器版仍可通过 HTTP 服务运行。

文档导航见 [`docs/README.md`](docs/README.md)。项目当前状态与交接清单见 [`docs/project-status.md`](docs/project-status.md)，Score 计算规则见 [`docs/recommendation-metrics.md`](docs/recommendation-metrics.md)，Windows 构建与验收步骤见 [`docs/windows-build-test.md`](docs/windows-build-test.md)。

## 目录结构

```text
.
|-- .gitignore
|-- LICENSE
|-- .github/
|   `-- workflows/ci.yml             # Windows/macOS 矩阵，实际运行待后续验收
|-- AGENTS.md
|-- README.md
|-- index.html
|-- my_plan.md
|-- omg-layout-2560x1440.json
|-- .nvmrc
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- tsconfig.app.json
|-- tsconfig.node.json
|-- src-tauri/
|   |-- capabilities/default.json
|   |-- Cargo.toml
|   |-- Cargo.lock
|   |-- build.rs
|   |-- icons/                       # Windrun favicon-derived desktop icons
|   |-- src/
|   |   |-- lib.rs
|   |   `-- main.rs
|   `-- tauri.conf.json
|-- vite.config.ts
|-- docs/
|   |-- README.md
|   |-- cross-platform-refactor-plan.md
|   |-- project-status.md
|   |-- windows-build-test.md
|   |-- recommendation-metrics.md
|   |-- ui-library-adoption-plan.md
|   |-- cc-switch-reference.md
|   `-- ability-draft-plus-analysis.md
|-- heroes/
|   `-- selection/                    # 127 张英雄模板源图
|-- public/
|   |-- assets/
|   |   |-- ability-icons/             # 509 张本地图标
|   |   `-- hero-icons/                # 127 张本地图标
|   `-- data/
|       |-- icon-signatures.json
|       `-- snapshots/
|           `-- latest.json
|-- reports/
|   |-- ability-icon-cache.json
|   |-- hero-selection-map.json
|   `-- icon-self-check.json
|-- scripts/
|   |-- build-hero-selection-map.ts
|   |-- build-icon-signatures.ts
|   |-- cache-ability-icons.ts
|   |-- sync-windrun.ts
|   |-- verify-icon-signatures.ts
|   `-- verify-runtime-assets.ts
|-- src/
|   |-- App.tsx
|   |-- core/
|   |   |-- icon-path.ts / icon-path.test.ts
|   |   |-- layout.ts / layout.test.ts
|   |   |-- matching.ts
|   |   |-- pairs.ts / pairs.test.ts
|   |   |-- recognition.ts / recognition.test.ts
|   |   |-- recommendation.ts / recommendation.test.ts
|   |   |-- template-matching.ts / template-matching.test.ts
|   |   `-- tiers.ts / tiers.test.ts
|   |-- data/
|   |   `-- demoSnapshot.ts
|   |-- platform/
|   |   |-- capabilities.ts
|   |   |-- files.ts
|   |   |-- resources.ts
|   |   `-- storage.ts
|   |-- workers/
|   |   `-- recognizer.worker.ts
|   |-- main.tsx
|   |-- styles.css
|   |-- types.ts
|   `-- vite-env.d.ts
`-- tests/
    `-- fixtures/
        `-- README.md
```

`dist/`、`node_modules/`、`src-tauri/target/` 和 `src-tauri/gen/` 都是被忽略的生成目录，不属于版本化源代码；已废弃的旧脚本和文档清单见 [`docs/project-status.md`](docs/project-status.md)。

## 运行

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。

构建后可用 `npm run preview` 验证生产 `dist/`。网页必须通过 Vite 或其他 HTTP 服务访问，不支持直接打开 `file://` 文件。

桌面开发需要 Rust 1.85 或更高版本及 Tauri 系统依赖。Windows 环境准备、上传内容和验收命令见 [`docs/windows-build-test.md`](docs/windows-build-test.md)。安装完成后可运行 `npm run desktop:dev`，生产桌面构建运行 `npm run desktop:build`。桌面图标来源和生成方式见 [`src-tauri/icons/README.md`](src-tauri/icons/README.md)。

当前已在 Apple Silicon macOS 上生成 `.app` 和 `.dmg`，并在 Windows 完成 Tauri x64 安装包构建。安装包安装、重命名后的 release 可执行文件启动，以及 Windows/macOS WebView 中的完整识别流程仍需在目标系统复验。

运行时只读取仓库内的固定快照、模板签名和本地图标资源；需要主动更新数据时，按 [`docs/project-status.md`](docs/project-status.md) 中的顺序运行数据流水线。

## 截图布局校正

上传截图后会显示 60 个分类方框：英雄为蓝色、普通技能为绿色、终极技能为金色。

- 拖动方框可移动该格。
- 拖动右下角圆点可调整该格尺寸。
- 点击 `Re-slice` 后，裁剪像素和匹配结果会按当前布局重新计算。
- 默认布局来自根目录的 `omg-layout-2560x1440.json`；`Save layout` 会按当前图片分辨率下载完整布局，`Load layout` 会根据当前图片再次缩放。
- 校正中的覆盖坐标通过 `src/platform/storage.ts` 的浏览器适配器保存在 `localStorage`。

布局文件包含 60 个最终方框坐标，不依赖推导参数，因此应作为截图布局的版本化基准。默认文件的尺寸是坐标源尺寸，运行时会将 `x/width` 按图片宽度、`y/height` 按图片高度分别缩放。

## 数据与图标

`npm run sync:data` 从 Windrun 公开 API 生成固定的 `public/data/snapshots/latest.json`。当前快照包含：

- 3,122 个能力条目：127 个英雄、2,829 个普通技能、166 个终极技能。
- 636 个有统计记录的运行时候选：127 个英雄、387 个普通技能、122 个终极技能。

`npm run build:hero-map` 校验本地英雄选择图，并写入 `reports/hero-selection-map.json`。`npm run build:icons` 为所有英雄和具有 OMG 统计记录的技能候选生成图像签名，并写入 `public/data/icon-signatures.json`。当前包含 636 个候选能力、4,452 个变换签名；缺失的远端资源不会参与自动匹配。

`npm run cache:icons` 把运行时候选的 DatDota CDN 图标缓存到 `public/assets/hero-icons` 和 `public/assets/ability-icons`，并清理旧资源。网页优先读取本地缓存，缺失资源再回退 CDN。缓存清单写入 `reports/ability-icon-cache.json`。

- 普通和终极技能图标来自 DatDota 的能力图标资源。
- 英雄模板使用本地 Dota 2 VPK 导出的 `heroes/selection/{shortName}.png` 资源，生成特征时从非正方形图片中心裁剪最大正方形；ID、shortName 和文件路径映射写入 `reports/hero-selection-map.json`。
- 英雄匹配模板使用本地 `heroes/selection/{shortName}.png` 资源；英雄展示图标缓存到 `public/assets/hero-icons/{abilityId}.png`，普通和终极技能展示图标缓存到 `public/assets/ability-icons/{abilityId}.png`。缓存源是 Windrun 使用的 DatDota CDN，缺失资源才回退 CDN。
- 运行时不需要逐张下载图标：网页 Worker 只读取本地 `public/data/icon-signatures.json`。

## 匹配方式

每个截图格会裁剪中心区域并缩放为 `16x16` 灰度结构指纹，同时计算颜色特征；Worker 仅在对应类别的候选库中进行结构与颜色相似度排序，返回 top-10。

调试面板显示：

- 原始裁剪像素图
- 布局和裁剪坐标
- 当前匹配模式
- top-10 候选及评分

“模板匹配”表示正在使用真实图像签名；“颜色回退”表示本地签名文件未加载，结果不能作为识别结论。

## 推荐

确认候选技能后，可按类别锁定 Pick。推荐器只生成 `1 英雄 + 3 普通技能 + 1 终极技能` 的完整五 Pick 构筑，按平均单技能 `Win Rate` 与不重叠、经置信度收缩的 Pair/Triple 协同计算 `Score`。Tier 只用于候选排序和短名单优先级，不直接计入 Score。完整口径见 [`docs/recommendation-metrics.md`](docs/recommendation-metrics.md)。

统计快照不可用时，网页回退到内置演示数据；推荐结论应视为历史统计辅助，而不是胜率保证。

## 验证

```sh
npm test
npm run build
npm run verify:runtime
```

当前测试覆盖固定布局分类与尺寸校验、中心裁剪、模板特征与评分、候选排序、五 Pick 组合合法性、独立 Pair/Triple 互动与推荐排序。

## 已知限制

- 图标模板仍需要用更多人工标注截图验证 top-1/top-10 准确率。
- 当前布局只适配同一 OMG UI 构成；不同游戏 UI 或截图比例需要独立布局文件和新的黄金截图集。
- 当前已有浏览器适配层和已在 macOS Apple Silicon 上构建验证的 Tauri 最小外壳；没有 Wails 或原生窗口捕获实现。
- 数据和图标资源来自第三方或公开 CDN；发布或再分发前应确认对应许可与使用条款。

## 致谢

感谢 [Noxville/windrun](https://github.com/Noxville/windrun) 项目及其贡献者。本项目使用 Windrun 公开 API 生成统计快照，并引用其公开数据字段；本项目的推荐指标和排序逻辑由本项目自行定义，不代表 Windrun 官方评分。相关数据和资源的许可与再分发范围仍需按上游说明复核。
