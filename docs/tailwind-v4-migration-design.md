# Tailwind CSS v4 与 Tauri 2 控制台迁移设计

## 目标与边界

本次迁移以 **Windows Tauri 2/WebView2** 作为完整体验和自动化验收目标。浏览器构建保留为基础支持：可启动、加载本地快照、完成截图分析以及 Tier、Pairs、Draft 页面操作；它不承诺原生窗口、透明浮层或与桌面窗口尺寸完全一致的行为。

现有绿色和极紧凑的视觉结果不是兼容性目标，但在迁移早期保留现有信息架构与 720 × 920 窗口的可用性。不会引入宽屏侧栏式 IA、亮色主题、国际化路由、远程翻译加载或新的全局状态管理层。

`src/core/`、识别 worker、推荐/选秀算法及 Tauri 命令接口保持行为兼容。CCSwitch 只用于工程实践、可访问组件组合和依赖取舍参考；不复用其品牌、文案或图形资产。

## 三阶段交付

### 阶段 1：Tailwind v4 基础

- Vite 使用 `@tailwindcss/vite`；入口使用 `@import "tailwindcss" source(none)` 和显式 `@source "."`，避免扫描依赖目录。
- `@theme` 定义系统字体、圆角、阴影和中性深色 token；`src/styles.css` 只保留全局基线、token 与无法由工具类表达的规则。
- `cn`（`clsx` + `tailwind-merge`）和 Button、IconButton、Panel、Badge、Field、Tabs、Toolbar、EmptyState 构成稳定原语。带状态的样式必须使用完整 class 映射或 CVA 变体，不能运行时拼接 Tailwind 类名。
- 该阶段优先守住现有页面结构和紧凑窗口行为。

### 阶段 2：逐页样式迁移

- 按分析/布局、Tier/Pairs、Draft、Overlay 的顺序，将页面级布局与重复视觉模式从选择器 CSS 移至 TSX 工具类和共享原语。
- 每一批均运行 `npm test` 和 `npm run build`。避免同时改变识别、推荐或选秀逻辑。
- 720px 主窗口采用可横向滚动的导航和表格、允许换行的工具栏、纵向堆叠的 Draft 面板。浏览器宽屏只要求同一界面基础可用，不添加桌面专用信息架构。

### 阶段 3：产品增强与验收

- 在稳定组件边界上完成静态 UI 中英双语、覆盖层语言同步、原生窗口 E2E、文档和渐进式中性控制台调整。
- 视觉调整更新 token、状态色和密度，不强制重排页面层级。

## 设计 token

| 语义 | 值 | Tailwind 工具示例 |
| --- | --- | --- |
| 画布 | `#0b0d12` | `bg-canvas` |
| 基础面板 | `#121720` | `bg-surface` |
| 抬升面板 | `#1a2130` | `bg-surface-raised` |
| 边框 | `#2b3445` | `border-border` |
| 主文字 | `#eef2f7` | `text-text` |
| 弱文字 | `#94a3b8` | `text-text-muted` |
| 主强调 | `#60a5fa` | `bg-accent` / `text-accent` |
| 成功 | `#4ade80` | `text-positive` |
| 警告 | `#fbbf24` | `text-warning` |
| 错误 | `#fb7185` | `text-negative` |

颜色的语义名是稳定 API；页面不应重新引入绿色品牌色常量。现有历史 CSS 在阶段 2 逐批删除或替换，避免一次性重写造成紧凑桌面窗口回归。

## 国际化与 Overlay 数据流

`AppLocale` 只允许 `zh-CN` 或 `en`，首次运行默认为中文。语言偏好保存在 `omg-draft-seer.locale`，语言切换放在应用头部。英雄/技能原始数据、patch 名称和统计数值不翻译。

主窗口将 `locale` 放入 `OverlayState`，同推荐和 Tier 数据一起经既有 `BroadcastChannel` 与 localStorage 后备通道发送。独立 Tauri Overlay 读取该状态并切换同一份 i18n 资源，因此打开的浮层会在主窗口切换语言后实时更新。

## Tauri 原生 E2E

测试使用 WebdriverIO 的 `@wdio/tauri-service` 嵌入式 provider 与 `tauri-plugin-wdio-webdriver`，直接连接 Tauri WebView，而不是把 Chromium Playwright 当作桌面验收替身。测试专用 Rust feature `wdio` 才注册 `tauri-plugin-wdio` 和嵌入 WebDriver；正式 `desktop:build` 不启用该 feature。

`build:tauri:test` 会：

1. 以 `VITE_WDIO_E2E=true` 构建前端，以便装载 WDIO 前端桥接；
2. 以 `custom-protocol,wdio` feature 编译嵌入静态资源的 release 二进制；
3. 把测试副本置入服务当前解析的 debug 路径。

这保证测试不依赖 Vite 开发服务器，也不把 WebDriver server 带进正式桌面构建。当前 Windows E2E 覆盖导航、语言持久化、Tier/Pairs 筛选、截图识别和布局确认、Draft 策略以及原生浮层开启。

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

Windows 手工验收还应检查：主窗口在 720px 宽度时导航可用、两个透明原生浮层可开关且不拦截鼠标、语言切换同步到浮层，以及正式 `npm run desktop:build` 不包含测试 WebDriver feature。
