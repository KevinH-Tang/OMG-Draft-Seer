# Dota 2 OMG Pick Analyzer

本地网页工具，用于分析 Dota 2 OMG 选技截图。当前版本聚焦“布局已校正的截图 -> 图标模板匹配 -> 人工确认 -> 构筑推荐”闭环。

## 当前范围

- 只支持 `2560x1440` 的固定 OMG 选技界面截图。
- 候选池共 60 格：12 个英雄、36 个普通技能、12 个终极技能。
- 不支持其他分辨率、UI 缩放、皮肤或其他游戏画面。
- 布局不是自动检测的：需要先在网页中对齐方框，再进行裁剪和匹配。

## 运行

```powershell
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

运行时只读取仓库内的固定快照和本地图标资源；需要主动更新数据时，再按顺序运行 `npm run sync:data`、`npm run build:icons`、`npm run cache:icons` 和 `npm run verify:icons`。

## 截图布局校正

上传截图后会显示 60 个分类方框：英雄为蓝色、普通技能为绿色、终极技能为金色。

- 拖动方框可移动该格。
- 拖动右下角圆点可调整该格尺寸。
- 点击 `Re-slice` 后，裁剪像素和匹配结果会按当前布局重新计算。
- `Save layout` 会下载完整的 `omg-layout-2560x1440.json`；`Load layout` 可在另一台机器恢复同一布局。
- 校正中的覆盖坐标也会保存在浏览器 `localStorage`。

布局文件包含 60 个最终方框坐标，不依赖推导参数，因此应作为截图布局的版本化基准。

## 数据与图标

`npm run sync:data` 从 Windrun 公开 API 生成固定的 `public/data/snapshots/latest.json`。当前完整快照包含：

- 127 个英雄候选
- 2,829 个普通技能候选
- 166 个终极技能候选

`npm run build:icons` 仅为具有 OMG 统计记录的候选生成图标签名，并写入 `public/data/icon-signatures.json`。当前包含 636 个候选能力、4,452 个变换签名；缺失的远端资源不会参与自动匹配。

`npm run cache:icons` 只把 636 个候选能力的 DatDota CDN 图标缓存到 `public/assets/hero-icons` 和 `public/assets/ability-icons`，并清理旧资源。网页优先读取本地缓存，缺失资源再回退 CDN。缓存清单写入 `reports/ability-icon-cache.json`。

- 普通和终极技能图标来自 DatDota 的能力图标资源。
- 英雄模板使用本地 Dota 2 VPK 导出的 `heroes/selection/{shortName}.png` 资源，生成特征时从非正方形图片中心裁剪最大正方形；ID、shortName 和文件路径映射写入 `reports/hero-selection-map.json`。
- 英雄匹配模板使用本地 `heroes/selection/{shortName}.png` 资源；Heroes 展示图标缓存到 `public/assets/hero-icons/{abilityId}.png`，普通和终极技能展示图标缓存到 `public/assets/ability-icons/{abilityId}.png`。缓存源是 Windrun 使用的 DatDota CDN，缺失资源才回退 CDN。
- 运行时不需要逐张下载图标：网页 Worker 只读取本地图标签名 JSON。

## 匹配方式

每个截图格会裁剪中心区域并缩放为 `16x16` 灰度结构指纹，同时计算颜色特征；Worker 仅在对应类别的候选库中进行结构与颜色相似度排序，返回 top-10。

调试面板显示：

- 原始裁剪像素图
- 布局和裁剪坐标
- 当前匹配模式
- top-10 候选及评分

“模板匹配”表示正在使用真实图标签名；“颜色回退”表示本地签名文件未加载，结果不能作为识别结论。

已录入两条黄金标注，方便回归检查：

- 第 7 格：英雄 `Faceless Void`，ID `-41`
- 第 51 格：终极技能 `Doom`，ID `5342`

在这两格的调试面板中会显示黄金目标是否进入 top-10。黄金标注不会覆盖模型输出。

## 推荐

确认候选技能后，可选择已选技能。推荐器按平滑单技能胜率、技能对协同、样本量可信度和终极技能限制，输出最佳下一手和前 10 个方案。候选池较小时会完整枚举四技能构筑；候选池过大时会先按统计和已选技能协同筛选短名单，避免浏览器因组合数量过大卡顿。

统计快照不可用时，网页回退到内置演示数据；推荐结论应视为历史统计辅助，而不是胜率保证。

## 验证

```powershell
npm test
npm run build
```

当前测试覆盖固定布局分类与尺寸校验、中心裁剪、模板特征与评分、候选排序、组合合法性和推荐排序。

## 已知限制

- 图标模板仍需要用更多人工标注截图验证 top-1/top-10 准确率。
- 当前布局只适配同一 OMG UI 构成；不同游戏 UI 或截图比例需要独立布局文件和新的黄金截图集。
- 数据和图标资源来自第三方或公开 CDN；发布或再分发前应确认对应许可与使用条款。
