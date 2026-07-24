# Tauri 2 优先的 Tailwind CSS v4 改造计划

## 产品目标

- **Windows Tauri 2 是完整体验与持续 E2E 的唯一最高优先目标。** 主窗口、独立 Tier/推荐浮层、离线资源和窗口行为均以 Windows Tauri WebView2 为验收对象。macOS 仅支持 Apple Silicon `arm64` 的构建、签名和发布前原生手工验收，不建立常规 macOS E2E 门禁。
- Windows 正式版通过 GitHub Releases 直接分发经签名的 Tauri 安装包（MSI/NSIS）；不以
  Microsoft Store 或其他应用商店作为发布渠道。
- 浏览器构建保留为基础支持：能够启动、加载本地快照、完成核心分析与浏览 Tier/Pair/Draft 页面；不承诺与 Tauri 的窗口尺寸、原生浮层或自动化覆盖完全一致。
- 不保留既有绿色视觉语言；中性深色 token 的目标为画布 `#0b0d12`、面板 `#121720`、抬升面板 `#1a2130`、边框 `#2b3445`、文字 `#eef2f7`、弱文字 `#94a3b8`、强调 `#60a5fa`、成功 `#4ade80`、警告 `#fbbf24`、错误 `#fb7185`。现有布局和 720×920 紧凑窗口行为先保持稳定，再逐页渐进调整。
- 静态 UI 文案提供简体中文与英文；首次默认中文，用户选择以 `omg-draft-seer.locale` 持久化，并同步到独立 Tauri 浮层。

## 三阶段实施

### 阶段 1：Tailwind v4 基础迁移

- 启用 `@tailwindcss/vite`，使用 `@import "tailwindcss"`、顶层 `@theme` token 与最小全局基线；不改变当前页面结构或紧凑窗口行为。
- 建立 `cn`、Button、IconButton、Panel、Badge、Field、Tabs、Toolbar 与 EmptyState 等 UI 原语。继续复用 Radix、Lucide、Sonner 和 TanStack Virtual；不引入无业务需求的图表、拖拽、编辑器或服务端状态库。
- 动态 class 仅使用完整映射或 CVA 变体，避免 Tailwind 无法扫描的拼接类。此阶段结束时必须通过现有单测与前端构建。

### 阶段 2：页面级样式迁移

- 依次迁移分析/布局、Tier/Pairs、Draft、Overlay。每一批将局部 CSS 选择器替换为 TSX 工具类和共享原语，再执行现有测试与生产构建。
- 维持当前信息架构和 Tauri 720×920 适配：工具栏允许换行、表格允许横向滚动、Draft 小窗纵向排列。宽浏览器仅保证同一界面基础可用，不新增侧栏式 IA 或浏览器专属体验。

### 阶段 3：产品增强与验收

- 在稳定组件边界上加入中英双语、Windows Tauri 原生窗口 E2E、macOS 发布前手工验收、设计文档和渐进式中性控制台 token。视觉优化不强制重排页面布局。
- Windows 发布 job 在已验证并签名安装包后创建 GitHub Release、上传 MSI/NSIS 资产和发布说明；
  普通 CI/PR 验证不得发布或上传安装包。
- 拆分应用壳和可独立维护的页面视图，但保留 `src/core/`、worker、识别、推荐、选秀和 Tauri 命令的行为接口。

## Tauri 2 端到端测试

- 使用 WebdriverIO 的 `@wdio/tauri-service`，而非 Chromium Playwright，驱动 Windows Tauri 2/WebView2。`npm run test:tauri` 仅在 Windows CI 和 Windows 开发环境作为受支持的持续 E2E 命令执行。
- Rust 在测试 feature 下注册 `tauri-plugin-wdio-webdriver`；测试使用嵌入式 WebDriver provider，不需要外部 `tauri-driver` 或 EdgeDriver。正式 `desktop:build` 不启用该 feature。
- `build:tauri:test` 改为 Node/TS 编排脚本：由 `process.env` 注入 `VITE_WDIO_E2E=true`，构建 release 测试二进制，并通过共享 typed helper 按平台与目标三元组解析二进制路径。删除 Windows `set` 语法、`.exe` 硬编码和把 release 文件复制/改名到 debug 目录的暂存逻辑；WebDriver 直接使用解析后的 release 二进制。
- Windows 专用测试覆盖：主窗口启动、中文/英文切换和持久化、五页导航、Tier/Pairs 筛选与排序、布局确认弹窗、原生 Overlay 打开/关闭与主窗口状态同步、Draft 策略与回放控制、截图上传主路径。测试二进制绝不用于发布，发布打包仍由 `desktop:build` 负责。
- macOS 的 WKWebView embedded WebDriver 技术上可用，但不进入常规 CI，也不要求维护全量 macOS 测试用例。macOS 仅执行基础验证、桌面构建，以及发布前的 `.app`、透明浮层、点击穿透、Space 行为、签名和公证手工检查。
- GitHub Actions 保留原有 Windows/macOS 的 Vitest、前端构建和运行时资源检查；仅增加独立 Windows Tauri E2E job，失败时上传 WebdriverIO 日志、报告和测试结果。macOS 可增加桌面构建 smoke check，但不得成为完整原生 E2E job。

## 文档与验收

- `docs/tailwind-v4-migration-design.md` 记录 token、Tauri 窗口优先的响应式规则、组件边界、依赖取舍、i18n/overlay 状态流、Windows E2E 和 macOS 手工验收边界。
- 更新 `docs/README.md` 与根 `README.md`：明确 Windows Tauri 为最高优先目标、浏览器为基础支持，并区分 Windows E2E 命令与 macOS 发布前置条件。
- 交付验证：所有平台执行 `npm test`、`npm run build`、`npm run verify:runtime`；仅 Windows 执行 `npm run build:tauri:test` 和 `npm run test:tauri`。另从 GitHub Releases 下载最终 Windows 安装包，在 Windows 上手工检查主窗口、两个透明原生浮层和语言同步；macOS 发布候选执行 `npm run desktop:build`，并完成 `docs/PLAN_mac.md` 的手工验收清单。
