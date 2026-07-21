# Dota 2 OMG Pick Analyzer 当前计划

## 项目定位

这是一个浏览器端 React/Vite 工具，用于从 Dota 2 OMG 选技截图中识别 60 个候选格，并辅助确认技能、查看统计和组成四技能构筑。它不是游戏内叠加层，也不直接读取游戏窗口。

## 已完成

- 固定 `2560x1440` 基准布局，支持上传其他分辨率后按比例缩放，并允许在网页中人工校正。
- 按英雄、普通技能和终极技能分类裁剪截图，使用本地模板签名进行匹配，并保留颜色回退模式。
- 通过 Windrun 快照提供单技能、技能对和三技能统计。
- 支持人工确认候选、Tier List、Ability Pairs 和四技能构筑推荐。
- 已缓存运行时所需的英雄/技能图标，并提供图像签名生成和自检脚本。
- 已增加离线运行资源一致性校验，检查快照候选、签名和图标缓存清单是否同步。

## 当前数据流水线

```text
Windrun API
  -> npm run sync:data
  -> npm run build:hero-map
  -> npm run build:icons
  -> npm run cache:icons
  -> npm run verify:icons
  -> npm run verify:runtime
  -> npm test && npm run build
```

数据快照和派生资源属于版本化发布输入。刷新数据后应检查 `public/`、`reports/` 和资源数量的差异，再提交变更。

## 下一步

1. 使用更多经过人工标注的截图评估 top-1/top-10 识别准确率。
2. 按 [`docs/windows-build-test.md`](docs/windows-build-test.md) 完成 Windows 构建、Windows/macOS 目标 WebView 交互验收和第三方资源许可复核；macOS Tauri 外壳已实现。
3. 在许可确认后补充可再分发的黄金截图、60 格标签映射、识别回归结果和 CI 验收。

## 已退出当前链路

旧的 Python/OpenCV 自动布局探测、英雄网格切图和对应依赖不再参与当前项目，相关文件已废弃/删除。固定布局现在由根目录的 `omg-layout-2560x1440.json` 提供，完整清单和状态记录在 [`docs/project-status.md`](docs/project-status.md)。
