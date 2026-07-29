# Tauri 2 优先的 Tailwind CSS v4 改造与平台验收计划

> 状态（2026-07-24）：阶段 1 和阶段 2 已完成；阶段 3 部分完成。本文件合并原
> 原 Windows 与 macOS 两份计划已合并，本文保留为历史实施与平台验收记录，不是当前发布流程的唯一入口。
> 当前操作步骤以 `docs/platforms/windows/build-test.md`、`docs/platforms/macos/build-test.md` 和项目状态文档为准。

## 产品目标

- Windows Tauri 2/WebView2 是完整体验与持续原生 E2E 的最高优先目标。
- macOS 仅支持 Apple Silicon `arm64` 的桌面构建、直接分发和发布前手工验收，不维护第二套常规 WebDriver E2E。
- 浏览器构建保留为基础支持：能够通过 HTTP 启动、加载本地快照并使用核心分析、Tier、Pairs 和 Draft 页面，不承诺原生窗口、透明浮层或桌面窗口尺寸的等价行为。
- 不保留旧绿色视觉语言；使用中性深色 token、可缩放的 `720 x 540` 默认窗口、窄窗口堆叠/滚动和宽窗口并排布局。
- 静态 UI 支持简体中文和英文。首次运行默认为中文，偏好保存在 `omg-draft-seer.locale`，并同步到已打开的 Tauri 浮层。
- 本计划不扩大到游戏窗口捕获、全局快捷键、菜单栏常驻或 Mac App Store 分发。

## 三阶段实施

### 阶段 1：Tailwind v4 基础与跨平台测试构建整改（已完成）

- 启用 `@tailwindcss/vite`，使用 `@import "tailwindcss"`、顶层 `@theme` token 和最小全局基线；用响应式规则替代固定窗口尺寸假设。
- 建立 `cn`、Button、IconButton、Panel、Badge、Field、Tabs、Toolbar 和 EmptyState 等原语，继续复用 Radix、Lucide、Sonner 和 TanStack Virtual。
- 动态 class 仅使用完整映射或 CVA 变体，避免 Tailwind 无法扫描的运行时拼接。
- 新增跨平台的 `scripts/build-tauri-test.ts` 和 `scripts/tauri-test-target.ts`，使用 Node 环境变量和平台感知的 release 二进制路径，移除 Windows `set`、`.exe` 硬编码以及 debug 暂存副本。
- 测试 Rust feature 只在 `wdio` 下注册 `tauri-plugin-wdio` 与 `tauri-plugin-wdio-webdriver`，生产 `desktop:build` 不启用该 feature，也不监听 `TAURI_WEBDRIVER_PORT`。

### 阶段 2：页面级样式与窗口迁移（已完成）

- 按分析/布局、Tier/Pairs、Draft、Overlay 的顺序迁移局部 CSS 到 TSX 工具类及共享原语，不改变识别、推荐或选秀算法。
- 主窗口默认约 `720 x 540` 逻辑点，可自由缩放且不设置原生最小尺寸。工具栏可换行，表格可横向滚动，Draft 在窄窗口纵向排列、宽窗口使用并排布局。
- 保留透明、无边框、置顶、跨 Space 和鼠标穿透浮层行为，并通过 `macOSPrivateApi` 支持 macOS 直接分发。
- 浮层状态通过既有 `BroadcastChannel` 与 localStorage 后备通道同步；Windows E2E 覆盖行为，macOS 在发布候选中执行关键路径手工检查。

### 阶段 3：产品增强与发布验收（部分完成）

- 已落地静态 UI 双语、覆盖层语言同步、组件拆分、中性 token 和原生 E2E 基础设施及用例。
- Windows 原生 E2E 实际执行、安装包启动/安装验收、Windows 签名发布和 macOS 发布候选手工验收仍需独立完成。
- Windows 发布 job 需要未来配置签名、安装包验收和 GitHub Release 上传；普通 CI/PR 验证不得发布或上传安装包。

## Platform

### Windows x86_64（x64）

Windows x86_64 是完整桌面体验和持续原生 E2E 目标。支持 Windows 10/11 x64、WebView2 和
MSVC 工具链。当前仓库的 Windows 安装包目标是 x64，不是 32 位 x86。

#### 基线

- Node `22.12.0`、npm `>=10`。
- Rust `1.90.0` MSVC toolchain，以及 Rustfmt、Clippy。
- Visual Studio Build Tools 2022 的 C++ 工作负载和 Windows SDK。
- Microsoft WebView2 Runtime。

#### 原生 E2E 与构建

- 使用 WebdriverIO 的 `@wdio/tauri-service` 和 embedded WebDriver provider，执行
  `npm run build:tauri:test` 后运行 `npm run test:tauri`。
- Windows 允许按需下载 EdgeDriver，测试二进制使用 `custom-protocol,wdio` feature，不能作为正式发布包。
- E2E 用例覆盖主窗口、导航、双语持久化、Tier/Pairs 筛选、截图识别、布局确认、Draft 策略和原生浮层开启。
- 正式构建使用 `npm run desktop:build`，输出 MSI/NSIS 安装包。当前仓库尚未配置 Windows 签名或发布 workflow。

#### 验收边界

- 主窗口约 `720 x 540` 启动，可缩放且无原生最小尺寸锁定。
- 验证截图上传、60 slot 识别、Re-slice、候选确认、布局保存/载入和重启持久化。
- 验证 Tier、Pairs、Draft、推荐和两个独立原生浮层，以及双语状态同步和鼠标穿透。
- 下载并安装 MSI/NSIS 后重复启动和交互检查。此前记录中原生 WDIO E2E 与安装包 smoke test 尚未执行。

### macOS arm64

macOS 仅支持 Apple Silicon `arm64`（`aarch64-apple-darwin`）桌面构建和发布前手工验收。
WKWebView 不进入持续 WebDriver 门禁，透明浮层依赖 Tauri `macos-private-api`，因此不能提交
Mac App Store。

#### 基线

- Apple Silicon Mac、Node `22.12.0`、npm `>=10`。
- Rust `>=1.90` 和 `aarch64-apple-darwin` target。
- Xcode Command Line Tools 和可用的 macOS SDK。
- 不需要 WebView2、EdgeDriver、`tauri-driver`、Apple Developer credentials 或 `notarytool`。

#### 构建与分发

- 本地 app 构建使用 `npm run desktop:build -- --bundles app`，再执行
  `npm run verify:macos-bundle -- --require-arm64 --require-runtime-assets`。
- 发布候选构建 Apple Silicon DMG，使用 `hdiutil verify` 和同名 SHA-256 文件校验。
- GitHub Actions 只使用 `contents: write` 发布未认证 arm64 DMG；不使用 Developer ID 签名、公证或 stapling。
- Release 说明必须披露未认证状态、SHA-256 校验方法和 Gatekeeper 首次启动路径。
- 当前已有 arm64 `.app` 构建验证；最终 DMG 公开发布、SHA-256 上传和真机手工证据仍待完成。

#### 手工验收边界

- 记录 macOS 版本、芯片架构、显示器缩放和多 Space 状态。
- 验证主窗口缩放、截图识别、60 slot、Re-slice、候选确认、布局持久化、Tier/Pairs/推荐/Draft 和双语同步。
- 验证 Tier 与推荐浮层透明、无边框、置顶、跨 Space 可见、鼠标穿透且不显示为 Dock 独立应用。
- 从非开发目录启动保留 quarantine 的 DMG，记录 Gatekeeper 未识别开发者提示和用户控制的首次启动路径。
- 确认生产包未编入 `wdio` feature，启动后没有测试 WebDriver HTTP 端口。

## 共享构建、E2E 与 CI 边界

- 所有平台执行 `npm test`、`npm run build` 和 `npm run verify:runtime`。
- 只有 Windows 执行 `npm run build:tauri:test` 和 `npm run test:tauri` 作为持续原生 E2E。
- macOS CI 可执行基础构建和 bundle 资源 smoke check，但不维护全量 WKWebView E2E。
- Windows/macOS 共用 binary-path helper，但平台二进制、driver 和原生窗口生命周期必须隔离。
- 测试 feature 不得进入正式 `desktop:build`，正式生产包不得包含 WebDriver bridge 或测试端口。

## 文档与交付

- `docs/ui/tailwind-v4-migration-design.md` 记录 token、窗口响应式规则、组件边界、依赖取舍、i18n/overlay 数据流和 E2E 架构设计。
- `docs/platforms/windows/build-test.md` 是 Windows 当前操作指南；`docs/platforms/macos/build-test.md` 是 macOS 当前操作指南。
- 项目状态文档记录实际运行过的命令和剩余验收，不把计划内容写成已完成证据。
- 提交前至少执行：

```sh
npm test
npm run build
npm run verify:runtime
```

Windows 追加原生 E2E 命令；Apple Silicon 发布环境追加：

```sh
npm run desktop:build -- --bundles app
npm run verify:macos-bundle -- --require-arm64 --require-runtime-assets
```
