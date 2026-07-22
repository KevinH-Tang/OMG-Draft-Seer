# cc-switch 可借鉴组件评估

> 外部参考资料，不描述本仓库当前功能或依赖。仅在评估后续 Tauri 平台能力时使用。

> 评估日期：2026-07-22。参考项目：[farion1231/cc-switch](https://github.com/farion1231/cc-switch) 的 `main` 分支依赖清单与公开目录结构。

## 结论

cc-switch 与本项目同为 React + Vite + Tauri 2 桌面应用，适合作为平台适配、桌面插件和前端工程化的参考。其代理、OAuth、模型供应商、配置管理和数据库业务实现不适用于 Dota 2 OMG 截图识别产品，不应直接迁入。

优先考虑复用公共库并保留本项目现有 `src/platform/` 抽象，而不是复制 cc-switch 的应用代码。

## 建议采用

| 优先级 | 库或插件 | 当前对应点 | 建议 |
| --- | --- | --- | --- |
| 高 | `@tanstack/react-virtual` | `src/App.tsx` 的 Ability Pairs 手写虚拟滚动 | 用库替换固定行高、滚动位置和 overscan 计算，降低大表格滚动维护成本。 |
| 高 | `@testing-library/react`、`@testing-library/user-event`、`jsdom` | 当前 Vitest 主要覆盖 `src/core/` 和 `src/platform/` | 为上传截图、手动校准、布局 JSON 导入导出增加组件交互测试。 |
| 中 | `zod` | `parseLayoutDocument`、快照和导入文件校验 | 在外部数据结构扩大时定义运行时 schema；现有轻量解析逻辑不必立即重写。 |
| 中 | `@tauri-apps/plugin-log` | 桌面版识别失败和资源加载问题 | 通过平台适配层写入本地日志，便于 Windows/macOS 实机问题排查。 |
| 中 | `@tauri-apps/plugin-store` | `src/platform/storage.ts` 的浏览器 `localStorage` | 在 Tauri 环境持久化布局校准和偏好，浏览器模式保留现有回退。 |
| 低 | Radix UI primitives、Sonner、`cmdk` | 对话框、错误反馈、手动技能选择 | 仅在具体交互痛点出现时局部采用，避免整体 UI 重构。 |

## 平台插件边界

`plugin-dialog` 不应立即替换现有浏览器文件上传。当前 `src/platform/files.ts` 直接处理浏览器 `File`/`Blob`，可同时服务网页和 Tauri WebView。原生文件选择返回路径后还需要 Rust command 或文件系统插件读取内容，并增加 capability 权限管理；只有需要原生打开/保存位置时再引入。

若增加 Tauri 插件，必须同时处理：

- npm 包和 Rust crate 的匹配版本。
- `src-tauri/capabilities/` 中最小权限授权。
- 浏览器环境的无插件回退，继续由 `src/platform/` 对外提供统一接口。
- 桌面环境实测与构建验证。

## 暂不采用

以下 cc-switch 依赖服务于其特定产品需求，本项目暂无直接收益：

- CodeMirror：没有配置或代码编辑器场景。
- `@dnd-kit/*`：没有卡片或列表排序需求。
- Recharts：当前 Tier、Pairs 和推荐界面不需要监控型图表。
- `@tanstack/react-query`：运行时优先读取本地快照，尚不存在需要缓存、失效和重试管理的远程查询层。
- Tauri `plugin-process`、`plugin-updater`：前者没有子进程控制需求；后者应在签名发布、更新端点和回滚策略具备后再评估。

## 许可与引用

cc-switch 的 `package.json` 标注为 MIT。若复制其实现代码，必须保留原项目的版权和许可声明。更推荐独立安装所需公共库；新增依赖仍须分别核验许可证、维护状态和与本项目 AGPL-3.0-only 许可的兼容性。

参考：

- [cc-switch package.json](https://github.com/farion1231/cc-switch/blob/main/package.json)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Zod](https://zod.dev/)
