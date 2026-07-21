# Windows 构建与测试

本文是把工程交给 Windows 环境后的操作入口。项目桌面端只支持 Windows 和 macOS，浏览器版仍可通过 HTTP 服务运行；Linux、Android 和 iOS 不在支持范围内。

所有命令都从项目根目录执行。Windows 下可使用 PowerShell，命令不要求 Python 环境。

## 上传前检查

如果通过 Git 上传，确认以下新增目录和文件已经加入提交：

- `src-tauri/`
- `src/platform/`
- `docs/`
- `scripts/verify-runtime-assets.ts`
- `.github/workflows/ci.yml`
- `.nvmrc`
- 更新后的 `package.json` 和 `package-lock.json`

必须保留的运行时资源包括：

- `public/data/`
- `public/assets/`
- `heroes/selection/`
- `omg-layout-2560x1440.json`
- `src-tauri/icons/`

以下目录是本地生成物，不需要上传：

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `src-tauri/gen/`
- `.DS_Store`

不要使用 `git clean -fd` 清理当前工作区，除非已经确认所有新增的 Tauri 和平台适配文件都已提交或备份。

## Windows 环境

建议使用 Windows 10/11 x64，并准备以下工具：

1. Node.js `22.12.0`，npm `10` 或更高版本。
2. Rust stable MSVC 工具链，Rust `1.85` 或更高版本；当前开发环境使用 Rust `1.90.0`。
3. Visual Studio Build Tools 2022，安装 `Desktop development with C++`，同时包含 MSVC 和 Windows SDK。
4. Microsoft WebView2 Runtime。大多数 Windows 10/11 系统已经安装；缺失时需要单独安装 Evergreen Runtime。

安装完成后检查版本：

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

Rust 应使用 MSVC 工具链：

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

## 安装与基础验证

首次进入工程后执行：

```powershell
npm ci
npm test
npm run build
npm run verify:runtime
```

预期结果：

- `npm test` 的全部测试通过。
- `npm run build` 生成前端 `dist/`。
- `npm run verify:runtime` 报告 636 个运行候选、636 个签名 ID 和 636 个缓存清单 ID，失败数为 0。

## Tauri 开发运行

启动桌面开发窗口：

```powershell
npm run desktop:dev
```

首次运行可能需要 Cargo 下载 Rust 依赖。开发窗口启动后至少检查：

- 上传一张符合当前 OMG UI 的截图。
- 页面显示 60 个布局格，类别数量为 12 个英雄、36 个普通技能和 12 个终极技能。
- 调整布局后点击 `Re-slice`，识别结果能够更新。
- `Save layout` 导出布局，`Load layout` 能恢复布局。
- 关闭并重新打开窗口后，已保存的布局仍然存在。
- 识别结果、候选确认、Tier List、Ability Pairs 和推荐页面可以正常切换。

## Windows 生产构建

执行：

```powershell
npm run desktop:build
```

该命令会先执行生产前端构建，再执行 Tauri 打包。常见输出位置：

```text
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/msi/*.msi
```

安装一个生成的安装包并重新检查：

- 应用能正常启动，窗口尺寸和标题正确。
- 上传截图、识别、人工确认和推荐流程正常。
- 布局保存、加载和重启后恢复正常。
- 断网启动后仍能读取内置快照、签名和本地图标；缺失图标的 CDN 回退不属于离线验收范围。

## Windows 验收记录

建议在 Windows 上记录以下命令和结果：

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `node --version` / `npm --version` | 待填写 | 版本是否满足要求 |
| `rustc --version` / `cargo --version` | 待填写 | 是否为 MSVC 工具链 |
| `npm ci` | 待填写 | 是否有依赖安装错误 |
| `npm test` | 待填写 | 测试数量和失败信息 |
| `npm run build` | 待填写 | 是否生成 `dist/` |
| `npm run verify:runtime` | 待填写 | 失败数量 |
| `npm run desktop:build` | 待填写 | `.exe`/`.msi` 输出路径 |
| 安装包启动 | 待填写 | 是否出现 WebView2 或 DLL 错误 |
| 截图识别和布局持久化 | 待填写 | 是否完成完整流程 |
| 断网启动 | 待填写 | 内置资源是否可用 |

## 常见问题

- `cl.exe`、`link.exe` 或 Windows SDK 找不到：重新安装或修复 Visual Studio Build Tools 的 C++ 工作负载，并从新的终端重试。
- 应用启动时报 WebView2 错误：安装或修复 Microsoft WebView2 Runtime。
- Cargo 下载依赖超时：确认网络、代理和 crates.io 访问权限；不要删除 `Cargo.toml` 或 `Cargo.lock`。
- 构建目录内容异常：删除 `dist/`、`src-tauri/target/` 和 `src-tauri/gen/` 后重新执行 `npm run desktop:build`。这些目录会自动生成。
- 浏览器直接打开 `index.html` 失败：这是预期行为，请使用 `npm run dev`、`npm run preview` 或 Tauri 桌面命令。

## 当前限制

- 只支持当前固定 OMG UI 构成和 2560x1440 基准布局。
- 当前没有游戏窗口捕获、全局快捷键、系统托盘或游戏内叠加层。
- 图标识别准确率仍需要更多人工标注截图进行评估。
- Windrun、DatDota 和本地 VPK 资源的公开再分发需要在发布前复核许可。
