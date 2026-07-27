# Tailwind CSS v4 与 Tauri 2 控制台迁移设计

> 状态（2026-07-24）：这是已实施架构的设计记录。阶段 1 和阶段 2 已完成；阶段 3 的双语、
> Overlay 同步、中性 token、页面组件拆分和原生 E2E 基础设施及用例已经落地，但 Windows 原生
> E2E 实际执行、安装包验收及 macOS 发布候选手工验收仍待完成。

## 目标与边界

本次迁移以 **Windows Tauri 2/WebView2** 作为完整体验和持续自动化验收目标。macOS 使用
WKWebView，支持桌面构建、直接分发和发布候选手工验收，但不维护第二套常规 WebDriver E2E。
浏览器构建保留为基础支持：可启动、加载本地快照、完成截图分析以及 Tier、Pairs、Draft 页面操作；它不承诺原生窗口、透明浮层或与桌面窗口尺寸完全一致的行为。

现有绿色和极紧凑的视觉结果不是兼容性目标。迁移保留现有信息架构，但不再把固定窗口尺寸作为兼容边界：Tauri 默认以 720 × 540 启动、允许自由缩放且不设置原生最小尺寸，宽窗口可使用并排内容布局。不会引入宽屏侧栏式 IA、亮色主题、国际化路由、远程翻译加载或新的全局状态管理层。

`src/core/`、识别 worker、推荐/选秀算法及 Tauri 命令接口保持行为兼容。CCSwitch 只用于工程实践、可访问组件组合和依赖取舍参考；不复用其品牌、文案或图形资产。

## 三阶段交付

### 阶段 1：Tailwind v4 基础（已完成）

- Vite 使用 `@tailwindcss/vite`；入口使用 `@import "tailwindcss" source(none)` 和显式 `@source "."`，避免扫描依赖目录。
- `@theme` 定义系统字体、圆角、阴影和中性深色 token；`src/styles.css` 只保留全局基线、token 与无法由工具类表达的规则。
- `cn`（`clsx` + `tailwind-merge`）和 Button、IconButton、Panel、Badge、Field、Tabs、Toolbar、EmptyState 构成稳定原语。带状态的样式必须使用完整 class 映射或 CVA 变体，不能运行时拼接 Tailwind 类名。
- 该阶段优先守住现有页面结构和紧凑窗口行为。

### 阶段 2：逐页样式迁移（已完成）

- 按分析/布局、Tier/Pairs、Draft、Overlay 的顺序，将页面级布局与重复视觉模式从选择器 CSS 移至 TSX 工具类和共享原语。
- 每一批均运行 `npm test` 和 `npm run build`。避免同时改变识别、推荐或选秀逻辑。
- 窄窗口采用可横向滚动的导航和表格、允许换行的工具栏、纵向堆叠的 Draft 面板；宽窗口启用分析/调试并排和 Draft 三栏布局。浏览器与 Tauri 共用同一响应式信息架构。

### 阶段 3：产品增强与验收（部分完成）

- 在稳定组件边界上完成静态 UI 中英双语、覆盖层语言同步、原生窗口 E2E 基础设施和用例、文档及渐进式中性控制台调整。
- 视觉调整更新 token、状态色和密度，不强制重排页面层级。

## 设计 token

| 语义     | 值        | Tailwind 工具示例           |
| -------- | --------- | --------------------------- |
| 画布     | `#0b0d12` | `bg-canvas`                 |
| 基础面板 | `#121720` | `bg-surface`                |
| 抬升面板 | `#1a2130` | `bg-surface-raised`         |
| 边框     | `#2b3445` | `border-border`             |
| 主文字   | `#eef2f7` | `text-text`                 |
| 弱文字   | `#94a3b8` | `text-text-muted`           |
| 主强调   | `#60a5fa` | `bg-accent` / `text-accent` |
| 成功     | `#4ade80` | `text-positive`             |
| 警告     | `#fbbf24` | `text-warning`              |
| 错误     | `#fb7185` | `text-negative`             |

颜色的语义名是稳定 API；页面不应重新引入绿色品牌色常量。现有历史 CSS 在阶段 2 逐批删除或替换，避免一次性重写造成紧凑桌面窗口回归。

## 国际化与 Overlay 数据流

`AppLocale` 只允许 `zh-CN` 或 `en`，首次运行默认为中文。语言偏好保存在 `omg-draft-seer.locale`，语言切换放在应用头部。英雄/技能原始数据、patch 名称和统计数值不翻译。

主窗口将 `locale` 放入 `OverlayState`，同推荐和 Tier 数据一起经既有 `BroadcastChannel` 与 localStorage 后备通道发送。独立 Tauri Overlay 读取该状态并切换同一份 i18n 资源，因此打开的浮层会在主窗口切换语言后实时更新。

## 参考项目与边界

本设计曾参考 [cc-switch](https://github.com/farion1231/cc-switch) 在 commit
`a377d79303bc1e592d2783d559ca5bd6b8ba1417` 的系统字体、Tailwind/Radix/Lucide 组件组合、
格式化和 Rust 校验实践。该参考项目的依赖版本和 CI 不是本仓库的事实来源；实际依赖、脚本和
工具链以本仓库的 `package.json`、锁文件和工作流为准。只借鉴工程实践，不复用其品牌、文案、
合作方图标或其他图形资产。

## Tauri 原生 E2E

测试使用 WebdriverIO 的 `@wdio/tauri-service` 嵌入式 provider 与 `tauri-plugin-wdio-webdriver`，直接连接 Tauri WebView，而不是把 Chromium Playwright 当作桌面验收替身。测试专用 Rust feature `wdio` 才注册 `tauri-plugin-wdio` 和嵌入 WebDriver；正式 `desktop:build` 不启用该 feature。

`build:tauri:test` 会：

1. 以 `VITE_WDIO_E2E=true` 构建前端，以便装载 WDIO 前端桥接；
2. 以 `custom-protocol,wdio` feature 编译嵌入静态资源的 release 二进制；
3. 用共享 typed helper 按平台和可选目标三元组解析 release 二进制路径；不复制或改名测试副本。

这保证测试不依赖 Vite 开发服务器，也不把 WebDriver server 带进正式桌面构建。`build:tauri:test`
由 Node/TS 通过 `process.env` 注入构建变量，不依赖 Windows `set` 语法。`build.rs` 仅在
`wdio` feature 启用时选择 WebDriver capability；该权限只匹配 `main` 与 `overlay-*`，生产
包不编译测试插件或注册 HTTP server。WDIO 的 embedded provider 在 Windows 才设置
`autoDownloadEdgeDriver`；macOS 不下载 EdgeDriver。Windows E2E 用例覆盖导航、语言持久化、
Tier/Pairs 筛选、截图识别和布局确认、Draft 策略以及原生浮层开启。

macOS 的 `macos-private-api` 透明浮层只能直接分发，不能提交 Mac App Store。当前项目采用
GitHub Releases 的免费 arm64 DMG 策略，不使用 Developer ID 签名或公证，并同时发布 SHA-256。
WKWebView 的透明、点击穿透、多 Space 与 Gatekeeper 首次启动路径由 `macos-build-test.md` 的
发布前手工验收覆盖；Windows 保持持续 E2E 门禁。

## 依赖取舍

- 保留既有 Radix、Lucide、Sonner、TanStack Virtual。
- 新增 Tailwind v4、`clsx`、`tailwind-merge`、CVA、i18next/react-i18next，以及 WebdriverIO Tauri 测试栈。
- 不引入图表、拖拽、编辑器、表单框架或服务端状态库：当前功能没有对应需求，额外抽象会增加桌面窗口回归面。

## 验收清单

```sh
npm test
npm run build
npm run verify:runtime
npm run build:tauri:test
npm run test:tauri
```

Windows 手工验收还应检查：主窗口以 720 × 540 默认尺寸启动、缩放过程中布局按可用空间堆叠或滚动、放宽窗口后并排布局正常、两个透明原生浮层可开关且不拦截鼠标、语言切换同步到浮层，以及正式 `npm run desktop:build` 不包含测试 WebDriver feature。
