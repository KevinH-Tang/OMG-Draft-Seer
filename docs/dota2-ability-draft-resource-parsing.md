# Dota 2 技能征召布局资源解析与更新指南

记录日期：2026-07-25

## 目的

本文只描述如何从本地 Dota 2 编译资源中重新获取 Ability Draft 的布局输入，用于游戏更新后的复查和重新标定。运行时坐标投影、分辨率换算和截图裁剪规则见 `dota2-ability-draft-layout.md`。

需要重新获取的内容包括：

- 主 Panorama XML、CSS 和 JavaScript。
- `DOTAScenePanel` 使用的地图、相机和垂直 FOV 规则。
- `camera_1` 稳定镜头的原点、角度、FOV 和裁剪面。
- 普通技能、英雄和终极技能命中层的尺寸与 transform。
- `1024×1024` 动态纹理表中的槽位排列。
- 60 个 3D 图像模型和底座的实体坐标、角度与缩放。
- 代表模型的几何边界。
- 能够判断资源是否变化的 build ID、时间和 CRC。

本文不把场景世界坐标直接当作最终屏幕像素坐标；解析结果需要交给布局计算文档中的投影和截图标定流程。

## 当前调查快照

| 项目                                   | 值                                                   |
| -------------------------------------- | ---------------------------------------------------- |
| Steam App ID                           | `570`                                                |
| Dota 2 build ID                        | `24383975`                                           |
| Steam manifest `LastUpdated`           | `2026-07-25 21:10:05 +08:00`                         |
| Source 2 Viewer CLI                    | `19.2.6339+c72208352f5bf62f1482447ed166c548f303f8fa` |
| `pak01_dir.vpk` 修改时间               | `2026-07-25 21:09:51 +08:00`                         |
| `ability_draft_picker.vpk` 修改时间    | `2025-05-23 21:49:06 +08:00`                         |
| `ability_draft_picker_ad.vpk` 修改时间 | `2023-08-31 22:03:33 +08:00`                         |

Dota 2 更新后先记录新的快照，再与此表和后文 CRC 比较。不要只依据文件修改时间判断布局是否变化。

## 只读原则

- 所有游戏资源只作为 Source 2 Viewer 的 `-i` 输入。
- 反编译、实体文本和 glTF 输出全部写入系统临时目录。
- 不把 `-o` 指向 Dota 2 安装目录。
- 不覆盖、重打包、移动或删除任何 VPK、模型、材质或 Panorama 文件。
- 不启动资源编译、Workshop 上传、游戏验证或仓库数据刷新流程。
- 临时输出目录必须位于 Dota 安装目录之外。

## 1. 设置输入和临时输出

如果 Source 2 Viewer CLI 已加入 `PATH`，先确认实际命令和版本：

```powershell
$ViewerCommand = Get-Command 'Source2Viewer-CLI.exe' -ErrorAction SilentlyContinue
$ViewerCommand

if ($ViewerCommand) {
  & $ViewerCommand.Source --version
}
```

未加入 `PATH` 时，使用实际安装位置设置变量：

```powershell
$DotaRoot = (Resolve-Path '<Dota 2 安装目录>').Path
$Viewer = (Resolve-Path '<Source2Viewer-CLI.exe 路径>').Path
$Pak = Join-Path $DotaRoot 'game\dota\pak01_dir.vpk'
$SceneRoot = Join-Path $DotaRoot 'game\dota\maps\scenes\hud'
$Out = Join-Path $env:TEMP (
  'omg-draft-layout-' + [guid]::NewGuid().ToString('N')
)

New-Item -ItemType Directory -Path $Out | Out-Null
```

检查最终路径：

```powershell
$DotaRoot
$Viewer
$Pak
$SceneRoot
$Out
```

必须确认 `$Out` 不位于 `$DotaRoot` 内。

## 2. 记录 Steam build

安装目录位于 Steam 的 `steamapps\common` 下时，可从安装目录反推出 manifest：

```powershell
$SteamApps = Split-Path (Split-Path $DotaRoot -Parent) -Parent
$Manifest = Join-Path $SteamApps 'appmanifest_570.acf'

Get-Content -LiteralPath $Manifest -Encoding utf8 |
  Select-String -Pattern (
    'appid|name|buildid|LastUpdated|installdir|StateFlags'
  )
```

转换 `LastUpdated` Unix 时间戳：

```powershell
$line = Get-Content -LiteralPath $Manifest -Encoding utf8 |
  Select-String -Pattern 'LastUpdated'

if ($line.Line -match 'LastUpdated\s+(\d+)') {
  [DateTimeOffset]::FromUnixTimeSeconds([int64]$Matches[1]).ToLocalTime()
}
```

## 3. 发现 Panorama 资源

先在主 VPK 中列出相关 XML、CSS 和 JavaScript：

```powershell
& $Viewer -i $Pak --vpk_list -e 'vxml_c,vcss_c,vjs_c' |
  Select-String -Pattern 'abilitydraft|ability_draft|ad_texture_sheet'
```

当前应能定位到：

```text
panorama/layout/hud/dota_hud_abilitydraft.vxml_c
panorama/styles/hud/dota_hud_abilitydraft.vcss_c
panorama/scripts/hud/dota_hud_abilitydraft.vjs_c
panorama/layout/hud/dota_hud_ad_texture_sheet.vxml_c
panorama/styles/hud/dota_hud_ad_texture_sheet.vcss_c
```

如果名称改变，不要直接判定功能被移除。继续使用以下线索搜索：

- `DOTAScenePanel`
- `ability_draft_picker`
- `AbilityDraftAbilitiesHitbox`
- `AbilityDraftUltimatesHitbox`
- `HeroStripContainer`
- `panoramasurfacewidth`

## 4. 反编译 Panorama 资源

```powershell
$PanoramaResources = @(
  'panorama/layout/hud/dota_hud_abilitydraft.vxml_c',
  'panorama/styles/hud/dota_hud_abilitydraft.vcss_c',
  'panorama/scripts/hud/dota_hud_abilitydraft.vjs_c',
  'panorama/layout/hud/dota_hud_ad_texture_sheet.vxml_c',
  'panorama/styles/hud/dota_hud_ad_texture_sheet.vcss_c'
)

foreach ($Resource in $PanoramaResources) {
  & $Viewer -i $Pak -o $Out -d -f $Resource
}
```

反编译结果位于 `$Out\panorama`。保留原始反编译输出，不要在上面直接做手工整理；解析后的摘要应另存为文本或 JSON。

## 5. 定位独立场景 VPK

Ability Draft 场景不是主 `pak01_dir.vpk` 中的普通资源，而是位于独立 VPK：

```powershell
Get-ChildItem -LiteralPath $SceneRoot `
  -Filter 'ability_draft_picker*.vpk' `
  -File
```

当前快照包含：

```text
ability_draft_picker.vpk
ability_draft_picker_ad.vpk
```

主运行场景是 `ability_draft_picker.vpk`；相关预制体数据还可能出现在 `ability_draft_picker_ad.vpk` 中。更新后应同时比较两者的修改时间和资源列表。

## 6. 列出并反编译场景实体

```powershell
$ScenePak = Join-Path $SceneRoot 'ability_draft_picker.vpk'

& $Viewer -i $ScenePak --vpk_list `
  -e 'vmap_c,vents_c,vwrld_c,vrman_c,vvis_c,vmdl_c'

& $Viewer -i $ScenePak -o $Out -d `
  -f 'maps/scenes/hud/ability_draft_picker/entities/default_ents.vents_c'
```

实体清单输出位置为：

```text
maps/scenes/hud/ability_draft_picker/entities/default_ents.vents
```

检索相机、模型、位置、角度和缩放：

```powershell
$Entities = Join-Path $Out (
  'maps\scenes\hud\ability_draft_picker\entities\default_ents.vents'
)

Select-String -LiteralPath $Entities `
  -Pattern 'camera_0|camera_1|models/ui/abilitydraft|origin|angles|scales|fov' `
  -Context 5,5
```

需要结构化处理时，按 `====编号====` 分隔实体，再读取每个实体的键值行。必须保留实体名称、模型路径、`origin`、`angles`、`scales` 和相机参数，不能只保存经过排序的坐标数组。

## 7. 导出代表模型几何

以下命令只导出几何，不依赖材质：

```powershell
& $Viewer -i $Pak -o $Out -d `
  -f 'models/ui/abilitydraft/hero00_a0.vmdl_c' `
  --gltf_export_format gltf

& $Viewer -i $Pak -o $Out -d `
  -f 'models/ui/abilitydraft/hero00_hero.vmdl_c' `
  --gltf_export_format gltf

& $Viewer -i $Pak -o $Out -d `
  -f 'models/ui/abilitydraft/hero00_ult.vmdl_c' `
  --gltf_export_format gltf

& $Viewer -i $Pak -o $Out -d `
  -f 'models/ui/abilitydraft/ad_block.vmdl_c' `
  --gltf_export_format gltf
```

从 glTF accessor 记录每个模型的：

- `min` 和 `max` 几何边界。
- 节点变换矩阵。
- 顶点数或 accessor count。
- 是否存在新的缩放、旋转或父节点。

Source 2 Viewer `19.2` 在当前 Dota 2 build 上使用 `--gltf_export_materials` 时会报告 VCS `71` 超出其 `59` 到 `70` 支持范围。布局复查只需要几何和 UV 拓扑时，不应把材质导出失败当作几何解析失败。

## 8. 各资源需要提取的字段

### 主布局 XML

从 `dota_hud_abilitydraft.vxml` 提取：

- `DOTAScenePanel` 的 `map`、初始 `camera` 和 `light`。
- `panoramasurfacexml`、`panoramasurfacewidth` 和 `panoramasurfaceheight`。
- `pin-fov`、`particleonly` 和 `renderdeferred`。
- `#MainContainer`、`#AbilitiesScene`、命中层和角标容器的层级关系。
- 60 个命中槽位的类别、组和顺序。

### 主脚本 JavaScript

从 `dota_hud_abilitydraft.vjs` 提取：

- `HeroesReady()` 和快捷初始化函数。
- 切换到 `camera_1` 的时间、过渡时长和触发条件。
- `CameraMoveDone` 的设置时间。
- 技能块和英雄块 `spin` 动画的触发范围。
- 悬停、选择和按钮按下会改变模型状态的事件。

相机时间线决定截图是否属于稳定布局。只保存最终相机名称而忽略过渡时长，会导致动画中间帧被错误标定。

### 主 CSS

从 `dota_hud_abilitydraft.vcss` 提取：

- `#AbilityDraftAbilitiesHitbox` 的宽高、对齐、flow、transform 和预缩放。
- `#AbilityDraftHeroesHitbox` 及四个英雄容器的尺寸和边距。
- `#AbilityDraftUltimatesHitbox`、`#UltimateCorners` 和 `#AbilityCorners` 的尺寸与 transform。
- `.Ability`、`.Hero`、`.AbilitiesSet` 的宽高、margin 和分组间距。
- `.AspectRatio4x3`、`.AspectRatio21x9` 及其他宽高比选择器。
- `#MainContainer`、`#FullScreen` 和 `#AbilitiesScene` 的宽高与缩放规则。

### 动态纹理表 XML/CSS

从 `dota_hud_ad_texture_sheet` 提取：

- 纹理表宽高。
- 普通技能、终极技能和英雄图像单元尺寸。
- 每类图像的起始位置、流向和 margin。
- 元素顺序如何映射到实体模型名称和槽位编号。
- 是否新增天赋、先天技能、facet 或其他图层。

### 场景实体

从 `default_ents.vents` 提取：

- `camera_0` 和 `camera_1` 的全部参数。
- 每个 `ad_block.vmdl` 实体的名称、位置、角度和缩放。
- 每个 `heroNN_a0`、`heroNN_a1`、`heroNN_a2`、`heroNN_ult`、`heroNN_hero` 图像模型的变换。
- 相同类别中唯一坐标值、间距、排数和共面关系。
- 图像模型与底座模型之间的固定偏移。

## 当前核心资源基线

CRC 和尺寸来自 Source 2 Viewer `--vpk_list`，只用于判断本地版本是否发生变化：

| 资源                                                                 | CRC          |    大小 | 作用                                   |
| -------------------------------------------------------------------- | ------------ | ------: | -------------------------------------- |
| `panorama/layout/hud/dota_hud_abilitydraft.vxml_c`                   | `00d57fa9ff` | `10323` | 主界面、场景面板和 60 个透明命中槽位   |
| `panorama/styles/hud/dota_hud_abilitydraft.vcss_c`                   | `000b87fb7c` | `74548` | 命中层尺寸、透视变换、角标和宽高比规则 |
| `panorama/scripts/hud/dota_hud_abilitydraft.vjs_c`                   | `00e0d0573c` | `15305` | 相机切换、动画、悬停、选择和点击转发   |
| `panorama/layout/hud/dota_hud_ad_texture_sheet.vxml_c`               | `00967ca46a` |  `3679` | `1024×1024` 动态纹理表中的 60 个图像源 |
| `panorama/styles/hud/dota_hud_ad_texture_sheet.vcss_c`               | `00c96a9eab` |  `7846` | 纹理表单元尺寸、英雄区位置和状态效果   |
| `maps/scenes/hud/ability_draft_picker.vmap_c`                        | `001e802325` | `61360` | 主场景地图                             |
| `maps/scenes/hud/ability_draft_picker/entities/default_ents.vents_c` | `006d84fa35` | `13587` | 相机、模型和实体变换                   |
| `models/ui/abilitydraft/ad_block.vmdl_c`                             | `008fb8166d` | `37895` | 可动画的技能块底座和按钮模型           |
| `models/ui/abilitydraft/hero00_a0.vmdl_c`                            | `0055fd85be` | `25135` | 普通技能图像平面的代表模型             |
| `models/ui/abilitydraft/hero00_ult.vmdl_c`                           | `0011f432c3` | `25152` | 终极技能图像平面的代表模型             |
| `models/ui/abilitydraft/hero00_hero.vmdl_c`                          | `00ba583461` | `18722` | 英雄图像平面的代表模型                 |

CRC 未变化时，通常不需要重新标定对应资源；但 build 变化后仍应检查脚本是否引用了新的资源文件。

## 当前解析结果摘要

重新解析完成后，以下结果应与当前基线比较：

### 渲染入口

```text
map = scenes/hud/ability_draft_picker
initial camera = camera_0
panorama surface = panorama/layout/hud/dota_hud_ad_texture_sheet.vxml_c
panorama surface size = 1024 × 1024
pin-fov = vertical
```

### 稳定相机

```text
camera_1 origin = 260.980865 -0.347879 675.013245
camera_1 angles = 63.310432 179.989059 0.000000
camera_1 fov = 45.0
camera_1 znear = 4.0
camera_1 zfar = 1200.0
```

### 命中层和角标

```text
abilities hitbox = 1024 × 1024
abilities transform = rotateX(21deg) translateZ(0px) translateY(22px)
abilities pre-transform-scale2d = 0.6

heroes hitbox = 1254 × 1024
heroes transform = rotateX(21deg) translateZ(0px) translateY(22px)
heroes pre-transform-scale2d = 0.6

ultimate slot = 128 × 126
ultimate transform = rotateX(-15deg) translateZ(50px) translateY(116px) translateX(6px)
ultimate pre-transform-scale2d = 0.6

ability corners = 530 × 530
ultimate corners = 910 × 296
```

### 槽位拓扑

```text
hero slots = 12
ability slots = 36
ultimate slots = 12
total = 60
```

- 普通技能和英雄图像模型共面，统一位于 `z=167.853455`。
- 普通技能和英雄使用六个场景 X 行：`-84, -48, -12, 44, 80, 116`。
- 普通技能使用六个场景 Y 列：`-96, -60, -24, 24, 60, 96`。
- 英雄左右侧翼使用场景 Y：`-144` 和 `144`。
- 终极技能使用 Y：`-110, -66, -22, 22, 66, 110`，并有两套 X/Z 行。

### 代表模型边界

```text
hero00_a0   = [-12.448562, -12.448562, -1.4375] .. [12.448562, 12.448562, 1.1875]
hero00_hero = [-12.448562, -12.448562, -1.4375] .. [12.448562, 12.448562, 1.1875]
hero00_ult  = [-12.448562, -12.448562, -1.4375] .. [12.448562, 12.448562, 1.1875]
ad_block    = [-18.799995, -18.799995, 0] .. [18.799995, 18.799995, 25.437502]
```

整体三维 AABB 只能用于资源完整性检查，不能直接作为实体裁剪面。图像模型的纹理会从最高平台延伸到斜边：最高平台的 UV 仅为 `0.011444..0.113529`，完整技能纹理单元则为 `0..0.125`。因此 `z=max` 顶点范围只能描述平台，不能描述完整纹理足迹：

```text
hero00_a0 top face   = [-10.185187, -10.185187, 1.1875] .. [10.185187, 10.185187, 1.1875]
hero00_hero top face = [-10.185187, -10.185187, 1.1875] .. [10.185187, 10.185187, 1.1875]
hero00_ult top face  = [-10.185187, -10.185187, 1.1875] .. [10.185187, 10.185187, 1.1875]
ad_block top face    = [-13.103751, -13.103751, 25.437502] .. [13.103746, 13.103746, 25.437502]
```

图标裁剪使用完整纹理足迹投影到 `z=max` 平面的虚拟范围：

```text
hero00_a0 texture footprint   = [-12.448562, -12.448562, 1.1875] .. [12.448562, 12.448562, 1.1875]
hero00_hero texture footprint = [-12.448562, -12.448562, 1.1875] .. [12.448562, 12.448562, 1.1875]
hero00_ult texture footprint  = [-12.448562, -12.448562, 1.1875] .. [12.448562, 12.448562, 1.1875]
```

图标裁剪四边形必须由该纹理足迹、实体 `origin/angles/scales` 和 `camera_1` 共同投影得到。不能根据图像模型与底座模型的 origin 差直接生成屏幕 offset，因为两种模型的局部顶面 Z 不同，变换后的顶面实际基本重合。

## 保存解析结果

每次调查至少保存以下信息，建议使用一个带 build ID 的目录：

```text
<build-id>/
  manifest.txt
  viewer-version.txt
  vpk-resources.txt
  panorama/
  scene/
  models/
  parsed-camera.json
  parsed-slots.json
  parsed-css-layout.json
  comparison.md
```

建议结构化 JSON 至少包含：

- 输入 build ID、文件时间、资源路径、CRC 和尺寸。
- 相机字段的原始文本值和数值数组。
- 每个槽位的原始实体名称、模型路径和变换。
- CSS 选择器、原始属性值和单位。
- 纹理表元素顺序及其类别。
- 模型边界、节点矩阵和 Source 2 Viewer 版本。

不要只保存最终计算出的 60 个屏幕坐标，否则未来无法判断变化来自相机、实体、CSS、模型还是 UI 缩放。

## 更新后的比较规则

1. **先比较资源身份**：build ID、路径、CRC、尺寸和独立场景 VPK。
2. **再比较渲染入口**：ScenePanel map、纹理表、`pin-fov` 和相机名称。
3. **比较时间线**：稳定相机是否仍为 `camera_1`，过渡时长是否变化。
4. **比较平面关系**：普通技能与英雄是否仍共面，终极技能是否仍为独立平面。
5. **比较槽位拓扑**：类别数量、行列数、实体命名和纹理顺序。
6. **比较连续数值**：相机、坐标、角度、缩放、CSS 尺寸和 margin。
7. **最后更新计算基线**：只有影响投影或槽位几何的字段变化时，才更新布局计算文档和参考 JSON。

## 已知限制

- Source 2 Viewer 输出是对编译资源的重建，不是 Valve 的原始 Hammer、Panorama 或模型源文件。
- VMap 反编译可能提示缺少场景包内未提供的 `world_physics.vrman_c`；实体清单仍可独立解析。
- 当前 Viewer 不能完整解析 VCS `71` 材质着色器，但不影响实体、Panorama 文本和 glTF 几何核对。
- 未注入游戏运行时调试代码，因此不能从本流程直接读取引擎最终投影矩阵。
- 资源没有变化不代表截图一定稳定；相机过渡、技能块动画、DPI 和截图裁切仍需运行时检测。
- 第三方工具升级可能改变反编译文本格式，结构化解析器应容忍字段顺序和空白变化。

## 重新核对清单

1. 记录新的 Steam build ID、manifest 时间和 Source 2 Viewer 版本。
2. 比较五个 Panorama 核心资源的 CRC、尺寸和路径。
3. 比较主场景 VMap、实体清单和两个独立场景 VPK。
4. 反编译主 XML，确认 ScenePanel、动态纹理表和 `pin-fov`。
5. 反编译 JavaScript，确认稳定相机和动画时间线。
6. 反编译 CSS，确认三类命中层、角标和宽高比规则。
7. 反编译纹理表，确认 `1024×1024`、类别数量和槽位顺序。
8. 解析实体清单，确认两套相机和 60 个槽位模型变换。
9. 导出代表模型，比较几何边界和节点矩阵。
10. 生成结构化差异报告，区分无关资源变化和布局变化。
11. 若布局输入变化，更新 `dota2-ability-draft-layout.md` 中的相机、世界坐标、平面参数和验证结果。
12. 用新的稳定截图重新运行自动定位测试，再替换参考标定。
