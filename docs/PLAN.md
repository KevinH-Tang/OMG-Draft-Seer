# Tauri 2 优先的 Tailwind CSS v4 改造计划

## 产品目标

- **Tauri 2 是完整体验的唯一优先目标。** 主窗口、独立 Tier/推荐浮层、离线资源和窗口行为均以 Windows Tauri WebView2 为验收对象。
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

- 在稳定组件边界上加入中英双语、Tauri 原生窗口 E2E、设计文档和渐进式中性控制台 token。视觉优化不强制重排页面布局。
- 拆分应用壳和可独立维护的页面视图，但保留 `src/core/`、worker、识别、推荐、选秀和 Tauri 命令的行为接口。

## Tauri 2 端到端测试

- 使用 WebdriverIO 的 `@wdio/tauri-service`，而非 Chromium Playwright，驱动 Tauri 2 原生 WebView。
- 在 Rust 侧加入 `tauri-plugin-wdio-webdriver = "1"` 并在 `tauri::Builder` 注册插件；测试使用嵌入式 WebDriver provider，不需要外部 `tauri-driver` 或 Windows EdgeDriver。
- 新增 `wdio.tauri.conf.ts`、`tests/tauri/` 和 `npm run test:tauri`。CI 先生成前端资源与 release Tauri 二进制，再运行测试。
- Windows 专用测试覆盖：主窗口启动、中文/英文切换和持久化、五页导航、Tier/Pairs 筛选与排序、布局确认弹窗、原生 Overlay 打开/关闭与主窗口状态同步、Draft 策略与回放控制、截图上传主路径。测试构建复用 release 二进制，并在 Git 忽略的 debug 目录放置测试副本以兼容 WebDriver 服务的路径解析；发布打包仍由 `desktop:build` 负责。
- GitHub Actions 保留原有 Windows/macOS 的 Vitest、前端构建和运行时资源检查；增加独立 Windows Tauri E2E job，失败时上传 WebdriverIO 日志、报告和测试结果。

## 文档与验收

- `docs/tailwind-v4-migration-design.md` 记录 token、Tauri 窗口优先的响应式规则、组件边界、依赖取舍、i18n/overlay 状态流和 Tauri WebDriver 测试架构。
- 更新 `docs/README.md` 与根 `README.md`：明确 Tauri 为主要支持目标、浏览器为基础支持，并给出 Tauri E2E 前置条件与命令。
- 交付验证：`npm test`、`npm run build`、`npm run verify:runtime`、`npm run build:tauri:test`、`npm run test:tauri`。另在 Windows 上手工检查主窗口、两个透明原生浮层、语言同步和打包产物。
