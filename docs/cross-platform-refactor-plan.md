# 跨平台重构与桌面化迁移计划

> 状态：阶段 0/1 的浏览器适配已完成，Tauri macOS 生产 bundle 与 Windows x64 安装包均已构建验证；Windows/macOS 桌面交互验收待补。Windows 的具体操作见 [`windows-build-test.md`](./windows-build-test.md)。

## 1. 目标与范围

目标平台为 Windows 和 macOS，同时保留浏览器版本。首阶段只解决稳定运行、离线资源加载和桌面打包，不改变截图识别、人工确认和构筑推荐的产品行为。

当前项目的前端是浏览器运行时，桌面版本通过 Tauri 提供 Windows/macOS 外壳。`src/` 没有 Win32、DLL、注册表或进程调用；Node 数据脚本和固定布局资源继续作为开发/发布前工具，不要求最终用户安装额外运行时。当前浏览器版本通过 HTTP 服务运行，不支持直接打开 `file://` 文件。

## 2. 目标架构

保持领域逻辑与运行环境分离。`src/platform/` 当前已有浏览器实现，后续桌面壳只需替换对应适配器：

```text
src/core/             识别、模板匹配、布局、推荐算法，保持纯 TypeScript
src/workers/          浏览器/桌面 WebView 中运行的识别 Worker
src/platform/         资源、存储、文件选择和导出等运行时适配器
src/data/             演示数据
src/types.ts          共享领域数据类型
public/data/          可随应用打包的快照与模板签名
public/assets/        可随应用打包的图标资源
scripts/              数据同步、缓存、签名和验证工具
```

只抽象实际存在平台差异的能力：资源 URL、布局持久化、文件选择、文件导出和应用数据目录。识别算法不提前移植到 Go 或 Rust，以避免两套实现产生评分差异。

## 当前进度

已在浏览器端落地：

- Node 22.12.0 推荐版本、`engines`、锁定依赖和 `npm run preview`。
- `src/platform/` 浏览器适配层：Vite base 资源 URL、布局存储、JSON 导入导出和识别能力检查。
- `npm run verify:runtime` 本地离线资源检查；当前 636 个运行时候选、636 个签名 ID 和本地图标均通过。
- 离线校验还会核对签名数量/256 字节特征、缓存清单 ID、路径、状态和分类计数，避免快照与派生资源错配。
- `src-tauri/` Tauri v2 最小外壳、相对资源构建、窗口配置和 `core:default` 最小 capability；Rust 业务逻辑保持为空。
- Rust 工具链当前为 `1.90.0`，Cargo 最低版本声明为 `1.85`；Tauri CLI 固定为 `2.11.4`，crate 固定为 `tauri 2.11.5` / `tauri-build 2.6.3`。
- `npm run desktop:dev` 已验证可启动 macOS 开发窗口，`npm run desktop:build` 已生成 Apple Silicon `.app` 和 `.dmg`。

已退出当前实现的旧链路见 [`project-status.md`](./project-status.md) 的“已废弃文件清单”；当前默认布局和 TypeScript 数据流水线不依赖这些文件。

仍需补充：

- Windows/macOS 桌面交互验收结果；macOS `npm run desktop:build` 和 Windows x64 `npm run desktop:build` 已通过，`.github/workflows/ci.yml` 已配置 Windows/macOS 矩阵但实际运行仍暂缓。操作步骤见 [`windows-build-test.md`](./windows-build-test.md)。
- 4 份可再分发的 2560x1440 黄金截图及 60 格标签 JSON 已加入 `tests/fixtures/`，并由离线模板识别回归测试验证；后续可按相同格式扩展覆盖面。
- 至少一个目标 WebView 对模块 Worker、`OffscreenCanvas`、DPI 和布局重启持久化的实测；若能力不足，再实现主线程 Canvas 回退。
- 至少一次 macOS 桌面窗口内的截图上传、Worker 识别和布局持久化交互验收；开发窗口启动和生产 bundle 构建已通过，Windrun favicon 已接入，来源许可仍需发布前复核。

## 3. 分阶段计划

### 阶段 0：基线与工具链固定

- 为 Node 固定受支持的版本，并在 `package.json` 增加 `engines`；多平台构建统一使用 `npm ci`。
- 将 `package.json` 中的 `latest` 依赖改为明确版本，避免不同平台安装到不同依赖组合。
- 建立 Windows、macOS 的 `npm test` 和 `npm run build` 基线。
- 保留并扩展 2560x1440 黄金截图、布局 JSON 和识别结果，作为迁移前后的回归基准；当前已有 4 份已标注 fixture。
- 使用 POSIX shell 或平台无关的命令示例，路径示例改为相对路径或平台无关写法。

### 阶段 1：平台无关的 Web 重构

- 统一封装 `fetch('/data/...')`、`/assets/...` 和英雄资源路径，改用 Vite base URL 或资源适配器，不能依赖开发服务器根路径。
- 将 `localStorage`、布局 JSON 读取/导出封装为接口，保留浏览器实现。
- 检测 `createImageBitmap`、模块化 Worker 和 `OffscreenCanvas`；必要时增加主线程 Canvas 回退或明确的能力错误提示。
- 保证浏览器版在 HTTP 服务和生产 `dist/` 服务下都能运行；不把 `file://` 直接打开作为支持方式。

### 阶段 2：Tauri 最小验证（默认路线）

- 新增 Tauri 工程，复用现有 Vite 前端和 `dist/`，先不加入 Rust 业务逻辑。
- 配置开发启动、生产构建、资源打包和应用标识；优先验证 Windows，再验证 macOS。
- 逐项验证静态 JSON、PNG、模块化 Worker、`OffscreenCanvas`、文件上传、布局保存/加载和 DPI 缩放。
- 只有浏览器能力不足时才增加 Tauri 对话框、文件系统或路径插件；所有原生权限使用最小化 capability 配置。

### 阶段 3：Wails 备选路线

如果后续确定由 Go 负责截图、全局快捷键、窗口检测或系统托盘，则用 Wails 替代 Tauri 外壳，继续复用 `src/`。Go 只实现平台适配接口，通过显式绑定提供能力；不把识别和推荐逻辑复制到 Go。需要为 Go 绑定增加参数校验、错误转换和跨平台实现测试。

当前状态：暂缓，未创建 Wails 工程或 Go 绑定。

### 阶段 4：Go + 原生 UI/API（条件触发）

只有在需要原生控件、游戏窗口捕获、叠加层或 Windows/macOS 专用交互时进入此阶段。原生 UI 会重写上传、图片预览、SVG 布局覆盖、拖动缩放、调试面板和推荐展示；跨平台截图还要分别实现 Windows Graphics Capture 和 macOS ScreenCaptureKit。若仍保留 React 界面，Go + WebView 的方案应回到 Wails，而不是另造一套框架。

当前状态：未启动。不要恢复旧的 Python 自动布局脚本来替代这条路线；两者解决的问题不同。

## 4. 方案决策

| 方案 | 前端复用 | 初期改造 | 适合场景 | 决策 |
| --- | --- | --- | --- | --- |
| Tauri | 高 | 低 | 当前功能的轻量跨平台桌面封装 | 默认选择 |
| Wails | 高 | 低到中 | Go 系统能力和长期 Go 后端 | 有明确 Go 需求时选择 |
| Go + 原生 UI | 低 | 高 | 原生体验、窗口捕获或 Windows 专用工具 | 暂缓，需需求门槛 |

## 5. 验收标准

- 浏览器版行为和现有黄金结果一致，`npm test` 与 `npm run build` 在 Windows/macOS 通过。
- 桌面版可上传 2560x1440 截图并得到 60 个候选格。
- 布局调整、导入、导出和重启后的持久化行为一致；应用升级不会无提示丢失用户布局。
- 识别 Worker 失败时有可见错误或回退路径，不出现永久 loading。
- 桌面端不暴露任意 shell 执行、任意文件读写或未限制的原生 API；第三方数据和图标的来源与许可在发布前复核。

## 6. 主要风险与暂停条件

WebView 对 `OffscreenCanvas`、模块 Worker 和资源协议的差异是第一风险；任一目标平台无法稳定识别时，先完成主线程回退再继续打包。若需求仅是桌面分发，不应进入 Go 原生 UI 阶段。若出现直接读取游戏窗口、全局热键或叠加层需求，再重新评估 Wails 与平台原生 API 的投入。
