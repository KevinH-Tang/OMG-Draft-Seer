# macOS 构建与发布验证计划

## 审视结论与范围

本计划以 `docs/PLAN.md` 的 Windows 执行计划为基线，定义次级支持端
**macOS Tauri 2 / WKWebView** 的构建、分发和发布前手工验收。Windows 仍是完整体验与
持续 E2E 的唯一最高优先目标；macOS 不建立常规 WebDriver E2E job。浏览器构建仍是基础
支持：能够通过 HTTP 启动、加载本地快照并使用核心分析、Tier、Pairs 和 Draft 页面；不
承诺原生窗口、透明浮层或桌面窗口尺寸的等价行为。

截至 2026-07-24，仓库已有 macOS 所需的 Tauri 配置：`tauri` 启用了
`macos-private-api`，`tauri.conf.json` 设置了 `app.macOSPrivateApi: true`，并已经产出
Apple Silicon 的 `.app`。这使透明、无边框且鼠标穿透的浮层具备实现前提；由于本项目不
加入付费 Apple Developer Program，macOS 发布渠道确定为 GitHub Releases 的直接分发，
且不提供 Developer ID 签名、公证或 stapling。它不能提交 Mac App Store，下载者首次打开时
会受到 Gatekeeper 的“未识别开发者”保护流程约束。

Windows 计划中的页面迁移、设计 token、双语、核心算法边界和 720 x 920 紧凑信息架构
可直接保留。下列内容不能直接迁移，必须在实施前整改：

| Windows 假设                                 | macOS 对应方案                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebView2 是原生 WebView                      | 以 WKWebView 为唯一原生验收对象；窗口尺寸以逻辑点验证，不能用 Retina 截图像素代替。                                                                                                          |
| `set VITE_WDIO_E2E=true&& ...`               | 改为 Node/TS 编排脚本设置 `process.env`，或使用 POSIX 形式；不能继续使用 Windows `set`。                                                                                                     |
| `*.exe` 和 `target/debug/OMG-Draft-Seer.exe` | 由平台感知的解析器提供本机测试二进制；本机 arm64 使用 `target/release/omg-draft-seer`，不复制或改名 `.exe`。                                                                                 |
| EdgeDriver 自动下载                          | 使用 `@wdio/tauri-service` 的 `embedded` provider 和 `tauri-plugin-wdio-webdriver`；macOS 无需外部驱动，也不应保留 EdgeDriver 配置。                                                         |
| MSI/NSIS 为交付物                            | GitHub Actions 在发布时生成 Apple Silicon `arm64` `.dmg` 的同名 SHA-256 校验文件，并与 DMG 一起发布；不使用 Developer ID 签名、公证或 stapling，发布说明必须写明首次启动的 Gatekeeper 操作。 |
| Windows 单一 E2E job                         | 维持 Windows 为唯一持续 E2E job；macOS 只做基础 CI、桌面构建 smoke check（可选）和发布前手工验收。                                                                                           |

当前 `wdio.tauri.conf.ts`、`scripts/stage-tauri-test-binary.ts` 和 `package.json` 都硬编码了
Windows 二进制或命令解释器语法。因此在这些问题修复前，`npm run build:tauri:test` 和
`npm run test:tauri` 不应被视为 macOS 验收命令。即使完成脚本整改，该命令仍只在 Windows
执行；macOS 使用桌面构建与本计划的手工检查。现有
`src-tauri/target/release/bundle/macos/OMG-Draft-Seer.app` 为 arm64 且仅 ad-hoc 签名、没有
Team ID。它可作为免费分发策略的打包输入，但用户可见的 Release 不得把它称作“已签名”、
“已认证”或“通过 Gatekeeper”；ad-hoc 签名不提供 Apple 信任。

## 产品目标

- **Windows Tauri 2 是完整体验与持续 E2E 的唯一最高优先目标。** macOS 保留为可分发
  桌面构建和发布前原生验收目标；WKWebView、浮层、多 Space 和 Gatekeeper 行为通过
  有限的手工检查覆盖。
- 若发布 macOS，交付目标仅为 Apple Silicon `arm64`（`aarch64-apple-darwin`），不提供其他
  macOS 架构版本。
- macOS 公开版本通过 GitHub Releases 发布未获 Apple Developer ID 信任的 Apple Silicon
  `arm64` DMG 及 GitHub Actions 生成的 SHA-256 校验文件；不创建 Mac App Store 版本、不提交审核，也不以
  App Store Connect 作为分发渠道。
- Release 说明须明确标注“未由 Apple Developer ID 签名或公证”，并给出 Finder 的
  `Control`-点按“打开”及“系统设置 -> 隐私与安全性 -> 仍要打开”首次启动路径。只有在用户
  已核对发布来源和 SHA-256 后，才可将 `xattr -dr com.apple.quarantine` 作为终端用户的
  最后排障路径；它不是常规安装步骤，也不应在应用内静默执行。
- 继续使用中性深色 token：画布 `#0b0d12`、面板 `#121720`、抬升面板 `#1a2130`、边框
  `#2b3445`、文字 `#eef2f7`、弱文字 `#94a3b8`、强调 `#60a5fa`、成功 `#4ade80`、警告
  `#fbbf24`、错误 `#fb7185`。保留现有布局和 720 x 920 紧凑窗口行为，再逐页渐进调整。
- 静态 UI 文案提供简体中文与英文。首次默认中文，偏好保存在
  `omg-draft-seer.locale`，并实时同步到已打开的独立 Tauri 浮层。
- 不扩大为游戏窗口捕获、全局快捷键、菜单栏常驻或 Mac App Store 版本；这些均不属于
  本次范围。

## 环境与发布基线

### 开发与测试

在 macOS 真机上执行，优先使用与要验证架构一致的机器。基础环境为：

1. Node `22.12.0`、npm `>=10`，以 `.nvmrc` 与 `package.json` 为准。
2. Rust `>=1.90`；Apple Silicon 安装 `aarch64-apple-darwin`。
3. Xcode Command Line Tools（`xcode-select --install`）以及可用的 macOS SDK。完整 Xcode、
   `notarytool` 和 Apple 开发者凭据不属于本计划的发布前置条件。
4. 不需要 WebView2、EdgeDriver 或 `tauri-driver`。WKWebView 由系统提供，测试使用
   嵌入式 WebDriver。

先确认环境与工作树：

```sh
node --version
npm --version
rustc --version
rustup show active-toolchain
xcode-select -p
uname -m
git status --short
```

安装后执行基础验证：

```sh
npm ci
npm test
npm run build
npm run verify:runtime
```

### 免费分发与完整性

GitHub Release 的创建和附件上传只需要具有 `contents: write` 权限的 GitHub token；不配置、
请求或保存 `APPLE_*`、Developer ID 证书、私钥、app-specific password 或 notarization
credentials。`.github/workflows/release-macos.yml` 以此策略构建未签名 DMG；它不得依赖 Apple
secrets。

每次候选发布都要构建唯一的 arm64 DMG、校验磁盘映像，并由 GitHub Actions runner 生成同名
SHA-256 文件。实际文件名随版本变化，自动化必须在零个或多个 DMG 时失败，不能依赖示例文件名：

```sh
shasum -a 256 -c 'OMG-Draft-Seer-arm64.dmg.sha256'
```

GitHub Actions 在 GitHub Release 同时上传 DMG 和校验文件，并在说明中包含架构、提交 ID、校验说明、未认证状态
以及首次启动路径。`codesign --verify`、`spctl --assess`、`notarytool` 和 `stapler` 均不是本
策略的交付门槛，也不得用 ad-hoc 结果暗示 Gatekeeper 会直接放行。

## 三阶段实施

### 阶段 1：Tailwind v4 基础与跨平台测试构建整改

- 启用 `@tailwindcss/vite`，以 `@import "tailwindcss"`、顶层 `@theme` token 和最小全局
  基线取代局部旧样式；本阶段不重排页面，也不改变 720 x 920 主窗口行为。
- 建立 `cn`、Button、IconButton、Panel、Badge、Field、Tabs、Toolbar 和 EmptyState 等
  原语。继续复用 Radix、Lucide、Sonner、TanStack Virtual；不引入图表、拖拽、编辑器或
  新的服务端状态库。
- 动态 class 仅使用完整映射或 CVA 变体，禁止运行时拼接 Tailwind class，保证扫描结果
  在 Vite/macOS 构建中稳定。
- 新建一个跨平台的 `scripts/build-tauri-test.ts`，以 Node 子进程顺序执行：设置
  `VITE_WDIO_E2E=true` 的前端构建、带 `custom-protocol,wdio` feature 的 release Rust
  构建、测试二进制存在性与可执行位检查。用该脚本替换 Windows `set` 语法，避免引入只为
  传递环境变量的 shell 分歧。
- 以共享的 `scripts/tauri-test-target.ts` 或等价小型 typed helper 解析测试二进制：按
  `process.platform`、目标三元组和产品名得到路径。macOS 本机 E2E 指向
  `src-tauri/target/release/omg-draft-seer`；交叉编译时指向
  `target/<triple>/release/omg-draft-seer`。删除只为 Windows 服务路径解析而存在的复制和
  改名步骤，或将其严格限制在 Windows 分支。
- 将 `wdio.tauri.conf.ts` 改为消费该解析器。Windows 服务使用 `driverProvider: 'embedded'`、
  `embeddedPort`、启动超时和日志捕获；`autoDownloadEdgeDriver` 只允许 Windows 分支设置。
  macOS 不在 CI 中启动 WebDriver，但路径解析和构建脚本仍须可在 macOS 执行，以免开发
  工具链继续依赖 `.exe` 或 Windows shell。
- 测试 Rust feature 继续只在 `wdio` feature 下注册 `tauri-plugin-wdio` 与
  `tauri-plugin-wdio-webdriver`。生产 `desktop:build` 不得启用该 feature，也不得监听
  `TAURI_WEBDRIVER_PORT`。
- 扩展 `src-tauri/capabilities/default.json` 前先确认 overlay WebView 的测试权限。若 E2E
  需要切入浮层，测试权限只匹配 `main` 与 `overlay-*`，并且自动化 HTTP server 仍只由
  `wdio` Rust feature 提供；不要把 WebDriver bridge 放进正式构建。

阶段退出条件：Windows 上新的 `npm run build:tauri:test` 与 `npm run test:tauri` 可连续运行
两次，后一次不依赖前一次遗留的进程、端口或本地数据；macOS 上
`npm run desktop:build -- --bundles app` 可完成且不依赖 `.exe` 路径、Windows `set` 语法或
debug 暂存副本。

### 阶段 2：页面级样式和 macOS 窗口迁移

- 按分析/布局、Tier/Pairs、Draft、Overlay 的顺序迁移局部 CSS 到 TSX 工具类及共享原语。
  每一批执行 `npm test`、`npm run build` 和 `npm run verify:runtime`；不要在视觉迁移中
  改变识别、推荐或选秀算法。
- 主窗口仍为 720 x 920 **逻辑点**。工具栏可换行，表格可横向滚动，Draft 小窗纵向排列。
  Retina 显示器只会改变像素密度，不得改变 CSS 布局或以固定 PNG 尺寸作为断言。
- 保留 Rust 的 `transparent`、`decorations(false)`、`always_on_top(true)`、
  `visible_on_all_workspaces(true)` 和 `set_ignore_cursor_events(true)` 行为，并以
  `macOSPrivateApi` 为前提验证。若某个 macOS 版本拒绝透明或点击穿透，记录系统版本和
  原生错误；不得悄悄降级为会拦截游戏鼠标的浮层。
- 浮层状态经既有 `BroadcastChannel` 与 localStorage 后备通道同步。Windows E2E 覆盖其行为；
  macOS 在发布前手工检查先打开浮层后切换语言、主窗口关闭浮层以及重新打开时的状态恢复。
- 不为 WKWebView 建立全量 E2E 套件。截图上传、布局确认、Draft 策略及 Tier/推荐浮层的
  行为由 Windows E2E 持续覆盖；macOS 仅在发布候选中运行关键路径的手工 smoke check。

阶段退出条件：所有页面在 macOS 主窗口中无横向文本截断、无控件重叠，且每批变更均通过
基础验证与发布前 WKWebView 手工 smoke check。

### 阶段 3：Apple Silicon 构建、发布和验收

- 在 Apple Silicon 本机构建并测试 `arm64` 发布候选；不再构建或发布其他 macOS 架构版本。
- 对 `.app/Contents/MacOS/omg-draft-seer` 使用 `file` 或 `lipo -info` 验证 `arm64`；校验
  `npm run verify:runtime` 所覆盖的前端资源和内嵌资源。
- 生成唯一的 Apple Silicon DMG，执行 `hdiutil verify`，并由 GitHub Actions 生成和上传同名 SHA-256 文件；发布流程
  只使用 GitHub token 创建或更新 Release，不使用 Apple 证书或公证服务。将现有签名/公证
  release workflow 替换为这一流程。`macOSPrivateApi` 是该直接分发渠道的明确产品约束，
  GitHub 发布说明必须写明，不尝试走 App Store 审核。
- 在 Apple Silicon macOS 上完成一次下载、挂载、按文档处理 Gatekeeper 首次提示、启动、截图
  识别、布局持久化和浮层检查。
- 拆分应用壳和可独立维护的页面视图，但保留 `src/core/`、worker、识别、推荐、选秀和
  Tauri 命令接口的行为兼容性。

## macOS E2E 评估与 CI

`@wdio/tauri-service` 和已锁定的 `tauri-plugin-wdio-webdriver` 均支持 macOS 的
WKWebView embedded provider。技术上它会向测试二进制传入 `TAURI_WEBDRIVER_PORT`，测试
feature 注册的插件在该端口启动 W3C WebDriver server；不安装、不下载也不调用 EdgeDriver。
但在 Windows 是最高优先端的前提下，不值得为 WKWebView 生命周期、CI runner GUI 行为和
透明私有 API 的自动化差异维护第二套持续 E2E 门禁。

CI 变更如下：

1. 保留现有 Windows/macOS 的 Vitest、前端构建与运行时资源检查。
2. `tauri-e2e` 只运行在 Windows。它使用跨平台 helper，但 CI 仅以 Windows release
   二进制启动 WebDriver；失败时上传 WebdriverIO 日志、报告和测试结果。
3. macOS 可增加 `npm run desktop:build` 的非签名 smoke check，以尽早发现 Rust、SDK 或
   bundle 回归；它不是 E2E job，也不运行 `test:tauri`。
4. Apple Silicon `.app`/DMG 的构建可在 CI 作为非签名 smoke check。tag release job 仅需
   GitHub 的 `contents: write` 权限，用于在 GitHub Actions runner 生成 SHA-256 并上传 DMG 和校验文件；不得暴露、
   要求或验证 Apple secrets，也不运行签名、公证、stapling 或 Gatekeeper 放行检查。
5. Windows 和 macOS 的 binary path 与 driver 逻辑通过共享 helper 隔离，不能互相覆盖；
   删除 Windows 的 debug 暂存副本而不是用 macOS 专用分支延续该历史兼容层。

## 手工验收

从 GitHub Releases 下载 GitHub Actions 生成的最终 DMG 和其 SHA-256 文件，先核对校验值，再在安装版本中完成下列
检查，并记录 macOS 版本、芯片架构、显示器缩放和是否启用多个 Space：

- 主窗口以约 720 x 920 逻辑点启动；紧凑导航、横向可滚动表格和 Draft 纵向布局可用。
- 上传受支持截图，确认 60 个 slot、Re-slice、候选确认、布局保存/载入以及重启后的持久化。
- 依次操作分析、布局、Tier List、Ability Pairs、推荐与 Draft；确认中英文切换并在两个
  已打开的浮层内实时同步。
- 独立打开/关闭 Tier 与推荐浮层。确认透明背景、无边框、始终置顶、跨 Space 可见且鼠标
  事件穿透到下层窗口；在全屏应用和多个 Space 下重复检查。浮层不能因上述行为而获得
  焦点或显示为 Dock 独立应用。
- 在 Apple Silicon 上从非开发目录启动最终交付物。保留 quarantine 属性，确认预期的
  Gatekeeper 未识别开发者提示出现，并按 Release 说明通过 Finder `Control`-点按“打开”或
  “系统设置 -> 隐私与安全性 -> 仍要打开”完成首次启动；记录实际 macOS 文案和步骤。不得把
  该结果记录为 Gatekeeper 放行或 Apple 认证。
- 查看正式生产包的二进制，确认它未编入 `wdio` feature，且启动后没有测试 WebDriver HTTP
  端口。

## 文档与交付

- 新增 `docs/macos-build-test.md`，记录开发前置条件、架构构建、DMG 路径、SHA-256、GitHub
  Releases 发布流程、Gatekeeper 首次启动说明、手工验收与故障排查；不要改写 Windows 指南。
- 更新 `docs/README.md`、根 `README.md` 和项目状态文档：说明 Windows 是最高优先端，
  macOS 为 GitHub Releases 的未认证 arm64 直发与发布前验收支持；透明浮层依赖私有 API 且
  不适用于 Mac App Store，并列出 macOS 发布前置条件而非 macOS E2E 命令。
- 更新 `docs/tailwind-v4-migration-design.md`，保留 Windows/WebView2 的持续 E2E 叙述，
  补充 macOS/WKWebView 仅执行构建与手工验收的边界。
- 提交前交付验证至少包括：

```sh
npm test
npm run build
npm run verify:runtime
npm run desktop:build -- --bundles app
npm run verify:macos-bundle -- --require-arm64 --require-runtime-assets
```

前三条在 macOS CI 或开发环境执行，后两条在 Apple Silicon 开发或发布环境执行。
`npm run build:tauri:test` 与 `npm run test:tauri` 仅在 Windows 执行。生成 SHA-256 与上传
DMG 到 GitHub Releases 是独立发布授权，不包含在普通开发或 PR 验证中；Apple 签名和公证
不属于当前项目目标。
