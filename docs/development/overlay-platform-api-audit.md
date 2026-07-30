# Overlay 平台 API 与当前问题

> 记录日期：2026-07-30
> 状态：Windows 可见性故障修复及平台配置整理已实现；其余项目仍待评估或实施。

本文记录阶段 1 Desktop overlay 当前实现的修复状态、Windows/macOS API 差异和仍需处理的
workaround。它不描述尚未实现的阶段 2 Game-attached overlay，也不把 Windows 环境中的源码审计
当作 macOS 实机验收。

## 当前结论

Windows overlay 曾经进入 native show，但 WebView 无法完成 ready，`is_visible()` 持续返回
`failed to receive message from webview`。根因是主窗口和动态 overlay 在共享 WebView2 data
directory 时使用了不同的 browser args。当前工作区已经让 overlay 从合并后的主窗口配置读取相同
参数，并增加原生窗口创建屏障。

这次 WebView2 环境参数冲突不会原样发生在 macOS：WKWebView 不支持
`additionalBrowserArgs`。但是异步窗口创建、透明 WebView bootstrap 和 frontend-ready 握手是共享
生命周期，macOS 仍可能表现为“请求成功但窗口不可见”，只是需要按 WKWebView 路径单独诊断。

## 当前实现

本轮修复和整理包括：

- `src-tauri/tauri.windows.conf.json` 独占 WebView2 `additionalBrowserArgs`；公共
  `tauri.conf.json` 不再包含该 Windows 专用参数。
- 动态 overlay 从 `app.config().app.windows` 中查找主窗口配置并复用 browser args，不再维护一份
  Rust 字符串常量。
- `src-tauri/tauri.macos.conf.json` 独占 `macOSPrivateApi`，Cargo 的
  `macos-private-api` feature 也限定为 macOS target dependency。
- `visible_on_all_workspaces(true)` 仅在 macOS 构建中设置；`skip_taskbar(true)` 仅在 Windows
  构建中设置，避免把另一平台的 no-op 当成共享能力。
- 动态窗口构建后通过同一主线程队列建立创建屏障，再调用 `is_visible()`、窗口 setter 和 WDIO
  窗口发现。
- Windows 原生 E2E 增加真实 F8 全局输入、主窗口句柄恢复、快捷键状态归零和失败清理。

修复后的 Windows 原生测试记录为 8/8 通过。最新本地 WDIO 后端日志也观察到
`created -> page_load_started -> page_load_finished -> frontend_ready`，随后达到
`ready=true`、`visible=true`、`displayed=true`，并能正常隐藏。该自动化结果仍不代替 production
EXE、MSI、NSIS 的系统级像素验收。

## 仍待处理的问题

| 优先级 | 问题                                             | Windows 语义                                                                                                                                        | macOS 语义                                                          | 建议                                                                                                     |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1     | 快捷键释放 workaround 与依赖库重复               | 项目维护 `Code -> VK` 映射、`GetAsyncKeyState`、10 ms 释放轮询和 cycle 集合；锁定的 `global-hotkey 0.8.0` 已使用 `MOD_NOREPEAT` 并自行产生 Released | Carbon backend 原生发送 Pressed 和 Released                         | 受控实验删除 Windows 专用轮询和 `windows-sys`，统一进入现有 FIFO worker；真实 F8 Trigger/Hold 是回归门槛 |
| P1     | Windows 虚拟桌面行为没有实现                     | Tauri 明确不支持 `visible_on_all_workspaces`，当前已不再伪装设置该选项                                                                              | 该选项在 macOS Spaces 有效                                          | 明确为 Windows 产品限制；若必须跨虚拟桌面固定，需要 Windows 原生实现或调整需求                           |
| P2     | recommendation 的局部点击穿透依赖 40 ms 鼠标轮询 | Tauri 只能切换整个窗口的穿透状态                                                                                                                    | 同样只能整窗切换，并额外需要主显示器与窗口 backing scale 的坐标换算 | 将全屏展示层和面板大小的交互窗口拆开，删除轮询、interaction-region IPC 和 macOS 坐标分支                 |
| P2     | 窗口创建屏障依赖 runtime 队列顺序                | 当前修复有效，但 `run_on_main_thread` 只提供 FIFO 屏障，不能返回原始窗口创建错误                                                                    | 同样依赖 Tao/Wry 事件循环顺序                                       | 暂时保留；后续以 `PageLoadEvent::Started`、有界创建超时和失败回滚重构                                    |
| P2     | macOS 最新工作区尚未实机验收                     | 不适用                                                                                                                                              | 配置拆分、透明窗口、Spaces、穿透和快捷键仍需 Apple Silicon 验证     | 完成 arm64 app 构建、bundle 检查及人工 overlay smoke；不要从 Windows 构建结果推断通过                    |
| P3     | 原生 E2E 仍是 Windows-only                       | EdgeDriver、PowerShell/WScript F8 输入可验证真实 WebView2 全局快捷键                                                                                | 项目不维护 WKWebView WebDriver 门禁                                 | 保持测试适配层平台化；macOS 使用 release-candidate 手工验收                                              |

## 应保留的平台差异

以下项目不是应被消除的 hack：

- `additionalBrowserArgs` 是 WebView2 专用配置；macOS 不应接收它。
- `macos-private-api` 是 macOS 透明窗口所需能力，并决定该版本不能进入 Mac App Store。
- `RunEvent::Reopen` 处理 Dock reopen，只在 macOS 有意义。
- `windows_subsystem = "windows"` 是 Windows release 隐藏控制台的标准编译属性。
- Windows WDIO 的 EdgeDriver 下载和 WScript 全局按键注入属于平台验收适配器。
- npm 的 `.cmd`/`ComSpec` spawn wrapper 是低风险 Windows 构建兼容层；可以由
  `cross-spawn` 隐藏，但没有优先改造价值。

`always_on_top`、show/hide、窗口位置和显示器几何、整窗
`set_ignore_cursor_events`、tray、autostart、single-instance、IPC 和全局快捷键注册已经通过
Tauri 或插件抽象，不需要再建立两套平台实现。

## 推荐处理顺序

1. 保持完整 Windows 检查和真实 F8 E2E 作为配置化、窗口创建及后续 overlay 改动的合入门槛。
2. 在独立变更中删除 Windows 快捷键二次轮询，覆盖 Trigger、Hold、重复按下、快速松开和主窗口隐藏
   场景；若依赖库再次产生 stale release，保留 workaround 并记录可复现证据。
3. 将 Windows 跨虚拟桌面能力明确写成产品限制，除非产品决定引入平台原生实现。
4. 设计并实施 recommendation 拆窗，消除局部穿透轮询和 macOS 坐标换算。
5. 在 Apple Silicon 上验证透明 bootstrap、ready、点击穿透、Spaces、快捷键 Pressed/Released、Dock
   reopen 和最终 arm64 bundle。

## 验收边界

- Windows 自动化回归门槛：先运行 `npm run build:tauri:test`，再运行 `npm run test:tauri`。
- Windows 发布验收还需要 production EXE、MSI 和 NSIS 的系统级可见性证据。
- macOS 构建和 bundle 完整性不等于 WKWebView overlay 可见；必须执行 Apple Silicon 人工 smoke。
- 浏览器模式的同窗浮层不能证明 Tauri 原生 overlay 已显示。
- 窗口句柄存在、`open=true` 或 `PageLoadEvent::Finished` 均不能单独证明用户可见；最终状态至少应包含
  frontend-ready、成功的 OS visibility observation、有效显示器边界，并在发布验收中补充像素证据。
