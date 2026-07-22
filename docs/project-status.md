# 项目现状与交接清单

> 审计基线：2026-07-21；Windows 验证更新：2026-07-22。本文记录当前工作区的有效入口、交接资源、已废弃文件和待验收事项。

## 当前结论

当前项目是一个浏览器端 React/Vite 应用，并通过 Tauri v2 提供 Windows/macOS 桌面外壳。主流程是：上传截图、人工校正 60 个布局格、模板匹配、人工确认候选、查看 Tier/Pair 统计并生成五 Pick 推荐（1 英雄、3 普通技能、1 终极技能）。布局校正不是自动检测，项目也没有游戏窗口捕获或原生 API。`src/platform/` 已加入浏览器资源、存储、文件和能力检查适配层；macOS 和 Windows 的 Tauri 生产 bundle 均已通过构建验证。重命名前的 Windows release exe 已直接启动验证，`OMG-Draft-Seer` 重命名后的 release exe 待复测启动。

当前运行时资源没有发现结构性断链：

| 资源 | 当前检查结果 | 来源或用途 |
| --- | ---: | --- |
| `omg-layout-2560x1440.json` | 60 格 | 版本化默认布局 |
| `heroes/selection/` | 127 张 | 英雄模板源图 |
| `public/data/snapshots/latest.json` | 3,122 条能力、636 条统计记录 | Windrun 固定快照 |
| `public/data/icon-signatures.json` | 636 个候选、4,452 个签名 | Worker 模板匹配 |
| `public/assets/hero-icons/` | 127 张 | 英雄展示图标 |
| `public/assets/ability-icons/` | 509 张 | 有统计记录的普通/终极技能展示图标 |

快照生成时间为 2026-07-21；签名、缓存和自检报告主要生成于 2026-07-20。当前 ID、shortName、文件数量和图标路径仍然一致，但这些报告是派生结果，不应替代重新生成流程。

状态标签的含义：`有效` 表示当前代码或运行时入口；`派生` 表示由数据流水线生成、可以重建的发布输入；`生成目录` 表示本地构建产物，不提交；`已废弃/已删除` 表示不应恢复到当前链路；`暂缓` 表示保留决策记录，但没有实现或验收。

最近验证：2026-07-21 完成 macOS Apple Silicon `.app`/`.dmg` 构建，`npm test` 通过 37 个测试，`npm run verify:runtime` 检查 636 个运行候选、636 个签名和 636 个缓存清单 ID，0 个失败。2026-07-22 在 Windows 使用 Node `24.16.0`、npm `11.13.0`、Rust/Cargo `1.97.1` MSVC 工具链完成 `npm ci`、`npm test`、`npm run build`、`npm run verify:runtime` 和 `npm run desktop:build`；重命名前的 release exe 已直接启动验证。`OMG-Draft-Seer` 重命名后已重新生成 x64 MSI、NSIS 安装包及 release exe，待复测启动。CI、黄金截图、安装包安装和截图全流程仍按后续验收处理。

## 文件职责

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `src/` | 有效 | React 页面、Worker、布局、匹配、Tier List、技能对和推荐逻辑 |
| `src/platform/` | 有效 | Vite base 资源 URL、浏览器存储、文件导入导出和运行时能力检查 |
| `src-tauri/` | 有效；macOS/Windows bundle 已验证 | Tauri v2 窗口、相对资源构建和最小 capability；重命名前的 Windows release exe 已直接启动，重命名后待复测 |
| `src-tauri/icons/` | 派生；待许可复核 | Windrun favicon 派生的 Windows/macOS 桌面图标 |
| `.github/workflows/ci.yml` | 已配置；暂缓执行 | macOS/Windows 的 Node 基线和运行时资源检查；按用户要求暂不触发 CI |
| `docs/windows-build-test.md` | 有效 | 上传清单、Windows 环境准备、构建命令和验收记录模板 |
| `public/data/snapshots/latest.json` | 有效派生资源 | `sync:data` 的运行时数据输入 |
| `public/data/icon-signatures.json` | 有效派生资源 | `build:icons` 生成的模板签名 |
| `public/assets/` | 有效派生资源 | `cache:icons` 生成的本地图标缓存 |
| `heroes/selection/` | 有效源资源 | 本地 Dota 2 VPK 导出的英雄选择图 |
| `reports/` | 生成报告 | 用于审查缓存、映射和自检，不被网页直接读取 |
| `omg-layout-2560x1440.json` | 有效源资源 | 当前唯一的默认布局基准 |
| `scripts/*.ts` | 有效工具 | 数据同步、签名生成、缓存和校验；包括 `verify-runtime-assets.ts` |
| `tests/fixtures/` | 暂缓 | 只保留黄金截图格式说明，实际 fixture 等待许可与标注 |
| `dist/`、`node_modules/`、`src-tauri/target/`、`src-tauri/gen/` | 生成目录 | 不提交；需要时由构建、安装或 Tauri CLI 重新生成 |

## 数据刷新

从仓库根目录按以下顺序执行：

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
npm run verify:runtime
npm test
npm run build
```

每个脚本的输入和输出如下：

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `npm run sync:data` | Windrun `/api/v2` 公共接口 | `public/data/snapshots/latest.json` |
| `npm run build:hero-map` | 快照、`heroes/selection/` | `reports/hero-selection-map.json` |
| `npm run build:icons` | 快照、本地英雄图、DatDota 能力图 | `public/data/icon-signatures.json` |
| `npm run cache:icons` | 快照、DatDota CDN | `public/assets/`、`reports/ability-icon-cache.json` |
| `npm run verify:icons` | 快照、签名、本地英雄图和远端能力图 | `reports/icon-self-check.json` |
| `npm run verify:runtime` | 快照、签名、本地图标 | 终端校验，无公网访问 |

`sync:data`、`build:icons`、`cache:icons` 和 `verify:icons` 可能访问公网。网页运行时优先读取已提交的本地快照、签名和图标；缺失展示图标时才回退到 CDN。发布或再分发前需要复核 Windrun、DatDota 和本地 VPK 资源的许可。

## 上传与 Windows 验收

上传前应保留 `src-tauri/`、`src/platform/`、`public/data/`、`public/assets/`、`heroes/selection/`、`scripts/` 和 `package-lock.json`。`node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/` 和 `.DS_Store` 是本地生成物，不需要上传。

Windows 的完整环境要求、安装命令、桌面构建命令、安装包位置和验收记录见 [`windows-build-test.md`](windows-build-test.md)。以下 Windows 基准命令已于 2026-07-22 通过；后续仅需补齐安装包、截图全流程和布局持久化验收：

```powershell
npm ci
npm test
npm run build
npm run verify:runtime
npm run desktop:build
```

## 已废弃文件清单

以下路径已经退出当前实现，并已从工作区删除或清理；不要为了恢复旧流程重新添加它们：

| 路径或内容 | 状态 | 废弃原因 |
| --- | --- | --- |
| `docs/layout-candidate-summary.md` | 已废弃/已删除 | 描述 Python 自动布局候选、Canny/Lab/bright-dark 比较；当前应用只使用人工校正后的固定布局 |
| `scripts/detect-layout.py` | 已废弃/已删除 | 依赖 OpenCV/NumPy 的离线布局探测器，不在 `package.json` 脚本或运行时链路中 |
| `scripts/detect-layout.md` | 已废弃/已删除 | 只服务于已删除的 `detect-layout.py` |
| `requirements-layout.txt` | 已废弃/已删除 | 只包含已退出布局探测链的 Python 依赖 |
| `scripts/split-hero-grid.py` | 已废弃/已删除 | 面向旧英雄属性网格截图的 Pillow 切图器；当前使用 `heroes/selection/` 和 `build:hero-map` |
| 旧版 `my_plan.md` 内容 | 已替换 | 原文写的是 50 个候选、机器相关截图路径和未落地的初步计划；当前文件只保留 60 格、固定布局和 TypeScript 数据流水线 |
| `C:\Users\61797\Pictures\...` 截图路径 | 已废弃/已删除 | 仅属于旧机器的个人文件路径，不能作为项目输入或可复现步骤 |
| `hero_crops/`、`test_data/`、`__pycache__/` | 已清理 | 旧 Python/临时产物目录，不是当前运行时或测试资源 |

`dist/`、`node_modules/`、`src-tauri/target/` 和 `src-tauri/gen/` 不是废弃源码，而是忽略的生成目录；内容不一致时直接重新生成即可。`.DS_Store` 也是本地文件系统元数据，不属于项目内容。

## 暂缓但未废弃

- Windows/macOS 目标 WebView 的上传识别、DPI 及布局重启验收，等待对应系统环境。
- Windows 安装包安装和目标 WebView 交互验收；具体步骤见 [`windows-build-test.md`](windows-build-test.md)。
- CI 实际运行和可再分发的黄金截图，按用户要求放到后续验收阶段。
- Wails、Go 原生 UI、游戏窗口捕获、全局快捷键和叠加层，仅保留方案记录；当前没有实现依据，不应提前恢复。
- Windrun favicon、DatDota CDN 和本地 VPK 资源的公开再分发，等待来源许可复核。

## 上游致谢

感谢 [Noxville/windrun](https://github.com/Noxville/windrun) 项目及其贡献者。本项目通过 Windrun 公开 API 生成版本化统计快照；推荐指标和排序逻辑由本项目自行定义，不代表 Windrun 官方评分。数据和资源的许可与再分发范围仍需按上游说明复核。

## 仍然有效但需要标注范围的文档

- [`README.md`](../README.md) 是当前使用说明和数据流水线入口。
- [`windows-build-test.md`](./windows-build-test.md) 是上传后在 Windows 上编译和测试的操作手册。
- [`recommendation-metrics.md`](./recommendation-metrics.md) 描述推荐器的统计口径；它不代表 Windrun 官方的单一评分。
- [`docs/cross-platform-refactor-plan.md`](./cross-platform-refactor-plan.md) 是迁移路线图；阶段 0/1 和 Tauri macOS 最小外壳已落地，Wails 与原生窗口能力暂缓。
- [`tests/fixtures/README.md`](../tests/fixtures/README.md) 仅约定黄金截图的存放格式；当前仓库没有提交可再分发的截图 fixture。
