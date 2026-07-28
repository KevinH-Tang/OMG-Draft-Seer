# 悬浮层开启/关闭状态机与快捷键故障诊断

> 状态：维护中的现状文档。本文描述 2026-07-29 当前工作树中的行为和现场证据，
> 不是尚未实现的目标架构。后续实现改变所有权、事件链路或可见性语义时，必须同步更新本文。

## 1. 范围与结论

本文覆盖三类悬浮层：

| `OverlayKind`    | 原生窗口标签             | 用途                     | 默认原生尺寸                          |
| ---------------- | ------------------------ | ------------------------ | ------------------------------------- |
| `recommendation` | `overlay-recommendation` | Tier、候选技能与组合推荐 | `2560 x 1440`，按当前截图尺寸覆盖主屏 |
| `tier`           | `overlay-tier`           | Tier 列表                | `430 x 760`，内容变化时调整高度       |
| `layout`         | `overlay-layout`         | 识别矩形与 Tier 标记     | `2560 x 1440`，按当前截图尺寸覆盖主屏 |

修复前的现场诊断把“快捷键无效”定位到一个明确边界：

```text
macOS 按键
  -> tauri-plugin-global-shortcut
  -> Rust forward_global_shortcut       [已确认到达]
  -> app.emit(...)
  -> 主 WebView listenOverlayShortcut
  -> createOverlayShortcutController
  -> setOverlayOpen('recommendation')
  -> Rust open_overlay                  [已确认未到达]
```

故障不在默认 `Tab`、macOS 注册或窗口焦点，而在 `app.emit` 到前端控制器之间。当前实现
已经删除这条控制链：Rust 的 global shortcut handler 只把事件写入专用 FIFO worker，
worker 串行执行 Trigger/Hold 状态转换和原生窗口命令。Windows `Released` 还要确认主键
已经物理松开，避免旧 release 关闭新一轮按压。`omg-draft-seer-overlay-visibility` 事件只
向 React 投影结果，事件丢失不会阻止窗口打开或关闭。

## 2. 修复前现场证据

诊断环境为 macOS 26.5.1、Apple Silicon `arm64`、Tauri debug 应用。按证据强度排序：

| 证据                                                                | 结果                                                  | 排除范围                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| 主窗口有焦点时发送真实 `Tab`                                        | 推荐悬浮层未出现                                      | 排除“只因主窗口隐藏或 WebView 挂起”作为完整解释           |
| 设置页把快捷键改为 `F8`                                             | LLDB 命中 `set_overlay_shortcut(..., enabled=true)`   | 排除桌面运行时识别失败、设置事件未执行和 Tauri IPC 未到达 |
| 设置页在 native 调用成功后显示并持久化 `F8`                         | `set_overlay_shortcut` 返回成功                       | 排除快捷键解析或注册命令显式报错                          |
| 发送真实 `F8`                                                       | LLDB 命中 `forward_global_shortcut`，事件为 `Pressed` | 确认 macOS 注册、插件回调和 Rust handler 均有效           |
| 同一次 `F8` 后观察 `open_overlay`                                   | 断点未命中                                            | 将故障收窄到 native emit 与前端打开请求之间               |
| `src/platform/shortcuts.test.ts` 与 `src/platform/overlays.test.ts` | 既有 21 个测试通过                                    | 说明现有单元测试没有覆盖真实 native 事件交付故障          |

Carbon 探针的“跨进程重复注册返回值”不能用于判断某个快捷键是否已被本应用持有。
现场验证表明两个独立进程可以同时成功注册相同的 Carbon hotkey；只有同一进程内的重复
注册会稳定返回 `eventHotKeyExistsErr`。该探针结果不作为根因证据。

## 3. 状态所有权

桌面版由 Rust 独占控制状态，React 不再保存目标状态或请求版本：

| 层           | 当前所有者                         | 状态                                  | 含义                                       |
| ------------ | ---------------------------------- | ------------------------------------- | ------------------------------------------ |
| 快捷键注册   | Rust `RegisteredOverlayShortcut`   | `shortcut`, `registered`              | OS 实际注册状态                            |
| 快捷键周期   | Rust `OverlayShortcutStateMachine` | `mode`, `pressed`                     | Trigger/Hold 与按压去重                    |
| 原生生命周期 | Rust `OverlayLifecycle`            | `visible`, `ready`, `revisions[kind]` | 最新目标、首帧状态和每类请求版本           |
| 前端只读投影 | React state/ref                    | `overlayVisibility`, `revisions`      | 按钮展示；只接受不旧于当前 revision 的状态 |
| 实际窗口状态 | Tauri/Wry                          | 窗口存在、hidden/visible              | OS 当前是否实际显示窗口                    |

另有两条内容同步通道，不直接决定窗口是否显示：

- `localStorage` 持续保存每类 overlay 的最新内容，供新建 WebView 恢复；
- `BroadcastChannel` 持续向已创建的 overlay WebView 推送内容。

`overlayVisibility=true` 是 Rust 目标状态的投影，不等于窗口已经完成首帧；`visible` 集合
中的标签仍可能因为 `ready=false` 而处于隐藏加载状态。

## 4. 单个原生悬浮层状态机

对每个 `kind`，原生状态可以归纳为以下稳定状态：

| 状态                 | 窗口存在 | `visible` 包含标签 | `ready` 包含标签 | 实际显示 |
| -------------------- | -------- | ------------------ | ---------------- | -------- |
| `ABSENT`             | 否       | 否                 | 否               | 否       |
| `LOADING_HIDDEN`     | 是       | 否                 | 否               | 否       |
| `READY_HIDDEN`       | 是       | 否                 | 是               | 否       |
| `OPEN_WAITING_READY` | 是       | 是                 | 否               | 否       |
| `OPEN_VISIBLE`       | 是       | 是                 | 是               | 是       |

`recommendation` 在应用启动时由后台线程预热，所以通常从 `LOADING_HIDDEN` 开始；另外
两类窗口在首次打开前通常是 `ABSENT`。可能首次创建 WebView 的 Tauri 命令是 async，并把
窗口操作放进 blocking worker，避免在 Windows 主事件线程同步创建 WebView2。

### 4.1 原生转换表

| 事件                             | 前置状态/条件                 | 原生状态变化                                               | 结果                                     |
| -------------------------------- | ----------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `prepare_overlay(kind)`          | `ABSENT`                      | 创建透明、无边框、always-on-top、跨 Space、初始隐藏窗口    | `LOADING_HIDDEN`                         |
| `prepare_overlay(kind)`          | 窗口已存在                    | 重新应用 always-on-top；保留 cursor poller 的交互状态      | 可见性不变                               |
| WebView `PageLoadEvent::Started` | 窗口已存在                    | 清除 `ready`，恢复鼠标穿透并执行 `hide()`                  | `LOADING_HIDDEN` 或 `OPEN_WAITING_READY` |
| `open_overlay(kind)`             | 尺寸合法                      | 递增该 kind 的 revision，先记录 requested，再准备窗口      | 继续到版本校验                           |
| `open_overlay(kind)`             | revision 仍是最新且 requested | ready 时显示，否则继续隐藏                                 | `OPEN_VISIBLE` 或 `OPEN_WAITING_READY`   |
| `open_overlay(kind)`             | 准备期间被新请求覆盖          | 隐藏窗口并返回最新 Rust 状态投影                           | latest-request-wins                      |
| `toggle_overlay(kind)`           | 任意                          | 在同一把 Rust 锁内原子决定 open/close 并递增 revision      | 不依赖 React 的旧投影                    |
| `set_overlay_viewport`           | 截图尺寸合法                  | 保存尺寸并调整已存在的 recommendation/layout 窗口          | 保持各窗口 requested/ready 状态          |
| `mark_overlay_ready(kind)`       | 标签仍在 `visible`            | 把标签加入 `ready`，执行 `show()`，再检查请求仍有效        | `OPEN_VISIBLE`                           |
| `mark_overlay_ready(kind)`       | 标签不在 `visible`            | 只把标签加入 `ready`，不显示                               | `READY_HIDDEN`                           |
| `mark_overlay_ready(kind)`       | 原生显示失败                  | 清除 `ready`，关闭请求并递增 revision，发送 closed 投影    | 保持隐藏并向 WebView 返回错误            |
| `close_overlay(kind)`            | 任意                          | 先从 `visible` 删除标签，再隐藏窗口                        | `READY_HIDDEN` 或 `LOADING_HIDDEN`       |
| 主窗口 `CloseRequested`          | 任意                          | 递增各 kind revision，清空 `visible`，取消 Hold 并隐藏窗口 | 所有悬浮层关闭；`ready` 保留             |
| 应用 Quit                        | 任意                          | Tauri cleanup 后进程退出                                   | 全部终止                                 |

### 4.2 原生不变量

当前代码试图保持以下不变量：

1. 实际可见窗口必须同时满足 `requested && ready`。
2. `close_overlay` 必须先清除请求，再隐藏，避免迟到的 ready 回调复活窗口。
3. 每类 overlay 独立递增 revision；关闭一种 overlay 不会错误取消另一种的打开请求。
4. 页面重新加载时必须清除 ready 并隐藏，避免显示未完成绘制的透明空窗。
5. 预热只创建并加载窗口，不等于请求显示。
6. 页面加载和隐藏转换必须恢复鼠标穿透，不能让全屏透明窗口继续拦截输入。

## 5. 前端命令与只读投影

桌面按钮只发送 `open_overlay`、`close_overlay` 或原子 `toggle_overlay` 意图。每个命令返回
`{ kind, open, revision }`；Rust 同时发送相同结构的 best-effort 事件。React 用
`mergeNativeOverlayVisibility` 丢弃较旧 revision，并在 listener 建立后调用
`get_overlay_visibility` 补齐可能错过的状态。React 不回滚或补发原生命令，也不参与桌面
Trigger/Hold。

浏览器版不调用 native 命令，直接确认 `overlayVisibility`。当前 JSX 只渲染
`recommendation` 的浏览器内浮层；`tier` 和 `layout` 的独立窗口语义只在桌面版完整成立。

## 6. Ready 与内容同步状态机

原生窗口加载和内容到达是两条独立链路：

```text
主页面 overlayState 更新
  -> 为三类 overlay 写入 localStorage
  -> 为已创建 WebView 广播 overlay-state

Rust 快捷键或 UI 命令请求打开
  -> 原生窗口保持隐藏，等待内容与 runtime snapshot
  -> overlay WebView 从 localStorage 恢复首份状态
  -> overlay WebView 建立 BroadcastChannel
  -> 重试 postMessage(overlay-ready)，直到收到响应
  -> 主页面回发最新 overlay-state

overlay WebView runtime snapshot 请求成功或降级完成
  + 已收到主页面最新 overlay-state
  -> content ready

overlay WebView 每次 content-ready state 绘制
  -> 两次 requestAnimationFrame；隐藏 WKWebView 无帧时使用一次性 timer fallback
  -> mark_overlay_ready
  -> native 在 requested=true 时 show()
```

注意：localStorage 恢复内容可以构建隐藏首帧，但不能单独授权 native 显示。native 的
`ready` 表示 runtime snapshot 已结束、主页面最新内容已经握手且 React DOM 已 commit；窗口
能产生帧时还会优先等待两帧，隐藏预热窗口则由 timer fallback 打破无帧死锁。内容每次更新
都可能再次报告 ready，native 操作是幂等的。若 show/reconcile 失败，Rust 用新 revision
回滚为 closed，WebView 同时把 IPC 错误写入 console。

## 7. 快捷键注册状态机

### 7.1 注册与换键

| 状态                  | 事件               | 转换                                                |
| --------------------- | ------------------ | --------------------------------------------------- |
| `UNREGISTERED`        | 主页面 effect 启动 | 调用 `set_overlay_shortcut(saved, true, mode)`      |
| `REGISTERING(saved)`  | native 成功        | Rust 保存快捷键、注册状态、模式并返回实际状态       |
| `REGISTERING(custom)` | native 失败        | 尝试注册默认 `Tab`；成功后前端恢复并持久化 `Tab`    |
| `REGISTERING(Tab)`    | native 失败        | toast 错误；保持不可用                              |
| `REGISTERED(old)`     | 设置页录入 `new`   | native 先注销 old，再注册 new；成功后前端才保存 new |
| `REGISTERED(old)`     | new 注册失败       | native 尝试恢复 old；前端不更新设置并显示错误       |

设置页通过命令返回值和 `get_overlay_shortcut_status` 显示 Rust 的实际注册状态。换键或切换
模式会取消正在进行的 Hold，防止旧按键收不到 release 后悬浮层常驻；进入 Hold 模式还会
立即关闭 recommendation overlay，无论它此前由按钮还是 Trigger 打开。模式只在关闭成功
后提交；native hide/reconcile 失败时 Rust 保留原模式，前端可以安全重试。

### 7.2 桌面事件链

```text
OS key pressed/released
  -> global shortcut plugin
  -> forward_global_shortcut
  -> dedicated mpsc shortcut worker
  -> Windows release physical-key validation
  -> process_global_shortcut
  -> Rust OverlayShortcutStateMachine
  -> request_overlay_toggle/open/close
  -> Tauri/Wry native window

  -> best-effort overlay visibility projection -> React
```

桌面版不安装 DOM 快捷键 listener，也不把按键事件发送给主 WebView。主窗口隐藏、暂停、
尚未加载或 visibility listener 未建立都不会阻断快捷键到原生窗口的控制路径。投影发送失败
和原生窗口操作失败会写入 native stderr；listener/IPC 错误由前端 toast 展示。

### 7.3 浏览器事件链

浏览器版没有 OS 全局快捷键，只在页面有焦点时处理 DOM 事件：

```text
keydown -> 匹配 code/modifiers -> 排除 repeat/defaultPrevented/editable target
        -> preventDefault -> controller Pressed
keyup   -> 当前为 pressed 且按键匹配 -> controller Released
```

浏览器失焦或文档 hidden 时执行 controller reset；Hold 模式由此关闭悬浮层。

## 8. Trigger 与 Hold 状态机

桌面版 Rust 状态机和浏览器版 DOM 控制器都使用 `pressed` 去重，一次物理按压周期最多
执行一次 Pressed 转换和一次 Released 转换。

### 8.1 Trigger

| 当前状态         | 输入           | 动作                      |
| ---------------- | -------------- | ------------------------- |
| 推荐层关闭       | `Pressed`      | Rust 原子 toggle 为 open  |
| 推荐层打开       | `Pressed`      | Rust 原子 toggle 为 close |
| 任意             | `Released`     | 忽略                      |
| 按键长按自动重复 | 重复 `Pressed` | controller 去重，忽略     |

### 8.2 Hold

| 当前状态   | 输入                       | 桌面版 Rust 动作                     |
| ---------- | -------------------------- | ------------------------------------ |
| 任意       | 进入 `Hold` 模式           | 强制请求关闭推荐层                   |
| 关闭       | `Pressed`                  | 标记 pressed 并请求打开              |
| 已 pressed | 重复 `Pressed`             | 忽略                                 |
| hold 有效  | `Released`                 | 清除 pressed 并请求关闭              |
| hold 有效  | 主窗口隐藏、换键或切换模式 | cancel；清除 pressed 并请求/强制关闭 |
| 已 cancel  | 迟到的 `Released`          | 忽略，不重复关闭                     |

浏览器版进入 Hold 时同样先调用 `setOverlayOpen(..., false)`，随后只在主页面聚焦时处理
Pressed/Released。Pressed 会认领一个 Hold 周期，即使 overlay 已由按钮打开也不会重复 open；
Released、blur、document hidden 或 effect cleanup 会结束周期并关闭它。浏览器版不参与桌面
全局快捷键链路。

## 9. 修复后的关键不变量

桌面快捷键链路应满足：

```text
native Pressed 已确认
  => forward handler 必须把事件写入唯一的快捷键 worker
  => Rust 必须产生一次 Trigger/Hold 动作
  => Rust 直接更新 requested/revision 并操作原生窗口
```

该不变量不包含 React 或 WebView listener。UI 按钮与快捷键共用 Rust 的 request helpers；
关闭先递增 revision、清除 requested 再隐藏，所以迟到的 prepare/ready 不能复活窗口。

## 10. 跨平台约束

1. Windows 与 macOS 桌面版共用 Rust 状态机；浏览器版保持相同 Trigger/Hold 语义，但只
   处理聚焦页面的 DOM 输入。
2. 桌面快捷键不以主 WebView 正在运行、可见、有焦点或未被系统节流为前提。
3. `Tab` 是浏览器焦点导航键，也是辅助功能的重要输入。即使它不是本次 native 事件丢失
   的根因，也不适合作为唯一默认和唯一恢复路径；组合键及冲突反馈需要按平台验证。
4. Hold 依赖可靠的 release 事件。Windows worker 会忽略主键仍按下时到达的旧 release；
   窗口隐藏、应用失焦、系统休眠和键盘布局切换仍必须有 cancel/reset 转换，否则可能留下
   常驻悬浮层。
5. 当前 Windows E2E 只在主窗口聚焦时发送 `Tab`，尚未覆盖主窗口隐藏、后台或应用恢复。
   macOS 没有 native 自动化 E2E，只能依赖手工 smoke test。
6. `global-hotkey` 的平台能力不是完全相同的。若未来扩大到 Linux，Wayland 不能沿用 X11
   全局快捷键假设；本文当前产品范围仍是 Windows 和 Apple Silicon macOS。

## 11. 修复验收状态

自动化已覆盖：

- Trigger 每个按压周期只 toggle 一次；Hold press/open、release/cancel/close；
- 模式切换先执行 close 再提交；浏览器 Hold 可认领已打开 overlay；
- 专用 worker 顺序交付快捷键事件，Windows 旧 release 受物理键状态保护；
- 后台创建 WebView；每类 revision 独立，迟到 open 不会覆盖 close；
- React 投影拒绝旧 revision，浏览器快捷键不劫持 editable 元素；
- 前端 IPC 契约、全量 Vitest、Rust 单元测试、TypeScript build 和 Clippy。

2026-07-28 的 Apple Silicon macOS 兼容性构建已完成 Trigger native smoke：当前注册的
`Shift + Backquote` 在主窗口可见时可以关闭推荐层，主窗口通过 `CloseRequested` 隐藏后又
可以重新打开推荐层；CoreGraphics 分别确认 overlay 的 `onScreen` 从 `true` 变为 `false`，
再从 `false` 变为 `true`。该验证使用 Node 24，不替代 `.nvmrc` 固定的 Node 22 发布基线。

仍需真实 native smoke/E2E 证明：

1. Hold 在 press 后打开，在 release、主窗口隐藏、换键或切换模式后关闭，不会卡住。
2. Windows 自动化补充聚焦与隐藏窗口场景。
3. macOS 补充失焦但主窗口仍可见的 Trigger smoke，并在 Node 22 发布基线复验。

## 12. 代码索引

| 责任                                       | 路径                              |
| ------------------------------------------ | --------------------------------- |
| native 快捷键注册、回调、窗口生命周期      | `src-tauri/src/lib.rs`            |
| frontend native overlay IPC                | `src/platform/overlays.ts`        |
| 浏览器快捷键解析、去重和 editable 过滤     | `src/platform/shortcuts.ts`       |
| 设置/内容同步与 native 状态只读投影        | `src/App.tsx`                     |
| overlay ready、内容恢复和 BroadcastChannel | `src/components/OverlayViews.tsx` |
| 现有 focused-window Windows E2E            | `tests/tauri/desktop.e2e.ts`      |
