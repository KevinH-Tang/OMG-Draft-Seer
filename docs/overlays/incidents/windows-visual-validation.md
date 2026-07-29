# Windows 原生悬浮窗视觉验证问题

记录日期：2026-07-29

状态：跨平台代码修复已实现，Windows production/安装包视觉验收待完成

本文事故与验收范围仅指阶段 1 Desktop overlay。它不验证 Dota 窗口身份、客户区跟随、
游戏捕获或阶段 2 Game-attached overlay。

## 2026-07-29 修复进展

根因位于加载与可见性状态的错误合并：Windows WebView2 在初始 hidden 的透明窗口中可能
暂停 bootstrap，导致前端永远无法回报 ready；后续临时修复又在
`PageLoadEvent::Finished` 直接标记 ready，使“页面导航完成”错误替代了“内容已同步并绘制”。
此外，原生全屏窗口沿用了截图像素尺寸，不能保证窗口边界落在实际目标显示器内。

当前实现采用 Windows 与 macOS 共用的状态机和 Tauri 窗口 API：

- open 请求后创建 OS-visible 的透明窗口，避免 hidden WebView bootstrap 死锁；
- overlay React 页面在 runtime snapshot settled 且收到主窗口当前 `overlay-state` 前不渲染
  `[data-overlay-panel]`，两帧后才调用 `mark_overlay_ready`；
- `PageLoadEvent::Finished` 只记录诊断日志，不再修改 ready；
- `get_overlay_visibility` 同时返回 `open`、`ready`、`visibilityObserved`、Tauri
  `is_visible()` 的 `visible`、`displayed`、revision、位置、尺寸、窗口/目标显示器信息和
  `withinMonitorBounds`；可见性查询失败不会被折叠成合法的 hidden 状态；
- recommendation/layout 的内容坐标仍来自截图 viewport，但原生全屏窗口使用当前显示器的
  物理位置与尺寸；
- 创建、Started/Finished、frontend ready、show/hide、销毁和状态快照均记录 label 与
  revision；
- WDIO 按钮用例从主窗口查询上述状态，不再切换到第二个 WebView，因而可以可靠拒绝
  “句柄存在但 OS 不可见”的假阳性。

这些变更解决了已识别的跨平台生命周期根因，并提供了 Windows 现场验证需要的观测数据。
它们仍不能替代系统级像素证据；下方 production EXE、安装包、Trigger/Hold 和托盘路径的
人工视觉验收完成前，本事故不得改为“视觉验收通过”。

### macOS 跨平台原生 smoke 证据

在 macOS 26.5.1（Apple Silicon）上启动本轮修复的较早 arm64 production `.app`，通过
数据库页按钮打开 recommendation overlay。原生日志依次观察到：

```text
requested=true ready=false visible=true displayed=false within_monitor_bounds=true
requested=true ready=true  visible=true displayed=true  within_monitor_bounds=true
```

窗口位置为 `(0, 0)`，尺寸为 `2940 x 1912`，与 Tauri 返回的当前显示器物理边界一致。
系统级截图确认非透明 `[data-overlay-panel]` 像素出现；再次点击按钮后日志为
`requested=false ready=true visible=false displayed=false`，第二张系统截图确认面板消失。
这证明共用实现可在 WKWebView 路径完成透明 bootstrap、内容 ready、OS 显示和关闭，但不
替代 Windows WebView2 production/安装包视觉验收。后续 revision 失败保护与前端有界重试
变更已通过自动化和最新 arm64 `.app` 构建/资源校验，但尚未对最新产物重跑系统截图 smoke。

## 问题摘要

Windows production EXE 中，推荐悬浮窗无法通过页面按钮或配置的全局快捷键得到肉眼可见的结果。相同前端状态在浏览器模式下可以显示同窗浮层，但浏览器分支不创建 Tauri 原生窗口，因此不能作为桌面悬浮窗的验证证据。

一次排查还发现桌面目录中的旧 EXE 正在运行。应用启用了单实例插件，启动 `src-tauri/target/release/omg-draft-seer.exe` 时，请求会转交给已经运行的旧实例。退出旧实例并重新构建 production EXE 后，视觉问题仍可复现，所以旧实例是干扰项，不是该问题的完整根因。

## 用户可见现象

- 浏览器模式可以打开和关闭推荐浮层。
- Windows production EXE 中，点击推荐悬浮窗按钮后没有可见面板。
- 默认全局 `Tab` 快捷键没有产生可见面板，按键只改变了主 WebView 内的焦点。
- 主窗口和普通页面仍可正常显示。

## 修复前 E2E 的验证边界

`tests/tauri/desktop.e2e.ts` 中的按钮用例执行以下检查：

1. 进入数据库页面并记录现有窗口句柄。
2. 点击推荐悬浮窗按钮。
3. 等待窗口句柄数量增加。
4. 调用 `get_overlay_visibility` 并等待 `open=true`。
5. 再次点击按钮并等待 `open=false`。
6. 检查主窗口按钮的 `aria-pressed=false`。

这些断言只能证明 Tauri 窗口对象被创建、Rust 生命周期接受了请求以及主窗口投影状态发生变化。它们没有证明以下行为：

- 原生窗口的操作系统可见状态为 true。
- 悬浮 WebView 完成脚本执行和 DOM 渲染。
- 透明窗口包含非透明面板像素。
- 悬浮窗位于预期显示器和坐标。
- 用户实际能看到面板。

因此，原生 E2E 全部通过不能再被表述为“Windows 悬浮窗视觉验收通过”。

## 2026-07-29 现场证据

### 自动化结果

- `npm test`：25 个测试文件、125 项测试通过。
- `npm run test:rust`：27 项 Rust 测试通过。
- 原有 `npm run test:tauri`：8 项用例通过，其中按钮用例只覆盖句柄和生命周期状态。
- 快捷键 E2E 只验证注册和恢复，不验证操作系统按键产生可见悬浮窗。

### WDIO 视觉尝试

诊断时临时增强按钮用例，在新句柄出现后切换到第二个 WebView、查找 `[data-overlay-panel]` 并调用截图命令。切换后 WebDriver 在最基本的 `title` 和 DOM 命令上连续超时，PNG 未生成。

日志中的首个相关失败是：

```text
WebDriverError: Script execution timed out when running "title" with method "GET"
```

随后 `element` 查询也超时。由于 `@wdio/tauri-service` 的多窗口切换本身可能参与该失败，这一结果证明当前 WDIO 不能提供可靠视觉证据，但不能单独证明 WebView 内容为空。

### Windows 系统级截图

为绕过 WebDriver，诊断过程使用 Windows 系统级输入发送默认全局 `Tab`，随后直接抓取整个桌面。截图保存到本地忽略提交的：

```text
test-results/tauri-overlay-desktop.png
```

截图中主窗口正常可见，但不存在推荐悬浮面板。另一次按钮路径截图保存在：

```text
test-results/tauri-overlay-button-foreground.png
```

这些文件是本机诊断产物，不属于可提交的测试 fixture。

### 原生窗口枚举

按钮路径运行后，Windows 顶层窗口枚举发现主窗口仍为可见，同时存在约 `1920 x 1023` 的无标题窗口，其操作系统可见状态为 false。这与“句柄已创建但用户看不到”的现象一致。枚举结果仍需结合 Tauri 窗口标签或额外原生日志，才能区分外层窗口与 WebView2 内部宿主窗口。

Windows 应用事件日志在排查时间段内没有发现明确的 `omg-draft-seer`、WebView2 或 Application Error 崩溃事件。

## 构建与环境注意事项

- `build:tauri:test` 和 production 构建写入同一个 release EXE 路径。原生 E2E 结束后必须最后运行 production 构建，不能把 WDIO 特性二进制作为发布产物。
- WDIO 清理曾遗留测试进程并锁定 release EXE。覆盖构建前必须检查并只结束对应的精确进程。
- 本次 production Rust EXE 编译成功，但 `npm run desktop:build` 随后在 WiX `light.exe` 的 MSI 打包阶段失败。该打包问题与悬浮窗视觉问题分开跟踪。
- `5173`、`4173` 和 `4445` 没有遗留监听端口。

## 当前判断

当前证据支持以下结论：

1. 浏览器浮层和 Tauri 原生悬浮窗是两条不同渲染路径。
2. 原有 E2E 对按钮路径存在视觉假阳性。
3. `open=true` 表示生命周期请求状态，不等价于窗口已显示。
4. 窗口句柄增加不等价于 WebView 已渲染有效像素。
5. Windows production EXE 的悬浮窗视觉行为仍未验收通过。

后续代码审计确认存在三项确定性缺陷：hidden WebView2 bootstrap 风险、
`PageLoadEvent::Finished` 过早提交 ready，以及截图尺寸直接作为原生窗口尺寸。透明像素的
最终可见性仍必须由 Windows 系统级截图验证。

## 后续诊断要求

修复实现已完成以下可观测性与生命周期要求：

1. `get_overlay_visibility` 记录请求、ready、可见性查询是否成功、Tauri `is_visible()`、
   窗口位置、尺寸、窗口当前显示器和主窗口目标显示器。
2. 窗口创建、页面加载 Started/Finished、前端 ready、show/hide 和销毁日志携带 label/revision。
3. `open`、`ready`、`visible` 和 `displayed` 分离；系统截图继续作为像素可见的最终证据。

仍需在 Windows 上执行：

验收证据格式、五个场景、截图关联和 production/MSI/NSIS 矩阵由
`docs/overlays/production-acceptance/shared.md` 与
`docs/overlays/production-acceptance/windows.md` 定义；对应 harness 尚未实现，不能把
设计文档当作已执行证据。

1. 使用 production EXE 做系统级截图验证，不能只依赖 WDIO 测试二进制。
2. 单独验证按钮、Trigger 快捷键、Hold 快捷键和主窗口隐藏到托盘后的快捷键路径。
3. 使用最终 production 构建生成并安装安装包，再完成一次安装态视觉验收。

## 修复验收标准

Windows 悬浮窗只有同时满足以下条件才能标记为通过：

- 按钮打开后，Rust 请求状态为 open。
- 对应 Tauri 窗口的 `is_visible()` 为 true。
- 窗口坐标和尺寸落在目标显示器的有效范围内。
- 系统级截图包含 `[data-overlay-panel]` 对应的非透明面板像素。
- 按钮关闭后，窗口不可见且截图中面板消失。
- Trigger 模式一次按键只切换一次。
- Hold 模式按下显示、释放隐藏。
- 主窗口隐藏到托盘后，全局快捷键仍满足相同视觉行为。
- production EXE 和安装包各完成一次人工视觉验收。

在这些条件完成前，Windows 原生悬浮窗应保持“未解决/未视觉验收”状态。
