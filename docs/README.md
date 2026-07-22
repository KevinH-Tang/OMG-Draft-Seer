# 文档导航

本目录只记录 OMG-Draft-Seer 的当前实现、验证状态和经过标注的外部参考。产品入口和快速开始见仓库根目录的 [`README.md`](../README.md)。

## 当前项目

| 文档 | 用途 | 更新时机 |
| --- | --- | --- |
| [`project-status.md`](./project-status.md) | 当前功能、已验证范围、待验收项和交接清单 | 功能状态或验证结果变化时 |
| [`recommendation-metrics.md`](./recommendation-metrics.md) | 五 Pick 构筑的 Score、Pair/Triple 和展示口径 | 修改推荐算法时 |
| [`windows-build-test.md`](./windows-build-test.md) | Windows 环境、打包命令和验收记录 | Windows 验证或发布流程变化时 |
| [`cross-platform-refactor-plan.md`](./cross-platform-refactor-plan.md) | 浏览器/Tauri 平台边界和后续路线 | 桌面能力或路线决策变化时 |

## 参考资料

| 文档 | 状态 |
| --- | --- |
| [`ui-library-adoption-plan.md`](./ui-library-adoption-plan.md) | 已部分落地的 UI 库采用记录；不是功能需求 |
| [`cc-switch-reference.md`](./cc-switch-reference.md) | 外部 Tauri 项目参考；不代表当前依赖 |
| [`ability-draft-plus-analysis.md`](./ability-draft-plus-analysis.md) | 外部 Ability Draft 项目分析；不描述本仓库实现 |

## 维护规则

- 面向用户的功能、运行命令和项目边界应同步更新根目录 `README.md`。
- 推荐算法的任何可见变化必须同步更新 `recommendation-metrics.md` 与相应测试。
- 未实现的设想应标为“计划”或“参考”，不得写成当前功能。
- 验证结论必须写明平台、日期和已运行命令；未完成的实机流程保留为待验收项。
