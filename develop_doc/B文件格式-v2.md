# lab B 文件格式 v2

当前最新格式为 [B 文件 v3.1](B文件格式-v3.1.md)。本文保留 v2 的定位设计与历史迁移说明；当前程序保存时输出 v3.1，视频定位使用 locator.start/end。

状态：已实现；桌面应用交互回归由开发者手动执行。

更新日期：2026-10-16。

## 1. 目的与术语

- lab：Annotation_Lab；better：betternotes。
- B 文件 / anno 文件：ABEditor 的 `来源文件名.annotation.json`。
- C 文件 / comp 文件：CEditor 的 Composite JSON。
- Source：图片、视频或 PDF 来源文件。
- A Object：Rect、Arrow、Text、Polygon 图形数据。
- Entity（E 对象，有时称 B 对象）：自己的属性和有序 A Card 引用树。
- Frame（F）：来源文件中的一个画面，仅用作概念说明。磁盘和运行时均不维护独立 F 对象。

v2 为后续 better/lab 数据兼容建立基础。本次只改变 lab B 文件，尚未修改 better 格式或 C 文件格式。

## 2. 文件名和顶层结构

文件为 UTF-8 JSON；命名不变，例如 `教材.pdf.annotation.json`。

```json
{
  "schemaVersion": 2,
  "sources": [],
  "annotations": [],
  "simpleNotes": [],
  "entities": [],
  "collections": []
}
```

| 字段 | 含义 |
| --- | --- |
| schemaVersion | 数字 2，不能写成字符串 `"2"` |
| sources | 来源文件数组，当前 ABEditor 一个会话对应一个来源文件 |
| annotations | A Object 数组 |
| simpleNotes | 本次不修改；经过格式转换时原样保留 |
| entities | Entity 数组，结构和引用 ID 保持不变 |
| collections | 保留现有字段，当前编辑器保存为空数组 |

磁盘文件不再保存顶层 `frames`；A Object 不再保存 `frameId`、`timeStamp`。不保存图片像素或视频截图；预览仍需要原始来源文件。

## 3. Source

沿用现有结构：`id`、`kind`、`filePath`、`fileName`、`fileUrl`、`fingerprint`、`meta`、`createdAt`、`updatedAt`。

- kind：`image`、`video`、`pdf`。
- fingerprint：`size`、`mtimeMs`，用于文件变化检测/缓存，不是内容哈希。
- meta：图片宽高、视频宽高和时长、PDF 页数等。可以从来源文件重新读取。
- A Object 的 `sourceId` 引用 Source.id。

## 4. A Object

保存 `id`、`sourceId`、`locator`、`type`、`geometry`、`style`、`text`、`status`、`createdAt`、`updatedAt` 等原有图形字段。

| Source.kind | locator | 规则 |
| --- | --- | --- |
| image | `{}` | 来源文件本身就是完整画面 |
| video | `{"time":12.345678}` | 秒，有限非负数；不按设置的匹配容差舍入 |
| pdf | `{"physicalPage":12,"bookPageLabel":"8"}` | 物理页码为从 1 开始的正整数；书籍页码为标签，可为 `iii`、`A-1` 或 null |

`sourceId` 与 `locator` 是画面定位数据。学科角色等业务属性仍属于 Entity 或 A Card，不写入原始 A Object。

几何数据仍是相对于完整画面宽高的归一化坐标：

- Rect/Text：`{x,y,width,height}`。
- Arrow：`{x1,y1,x2,y2}`。
- Polygon：`{points:[{x,y}, ...]}`。

## 5. 完整 PDF 示例

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "id": "src_001",
      "kind": "pdf",
      "filePath": "C:\\notes\\教材.pdf",
      "fileName": "教材.pdf",
      "fileUrl": "lab-file://local/C%3A%5Cnotes%5C%E6%95%99%E6%9D%90.pdf",
      "fingerprint": {"size": 123456, "mtimeMs": 1792108800000},
      "meta": {"pageCount": 120},
      "createdAt": "2026-10-16T12:00:00.000Z",
      "updatedAt": "2026-10-16T12:00:00.000Z"
    }
  ],
  "annotations": [
    {
      "id": "a_001",
      "sourceId": "src_001",
      "locator": {"physicalPage": 12, "bookPageLabel": "8"},
      "type": "rect",
      "geometry": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3},
      "style": {"stroke": "#ffd45a", "fill": "rgba(255, 212, 90, 0.12)", "strokeWidth": 2},
      "text": "",
      "status": "active",
      "createdAt": "2026-10-16T12:00:00.000Z",
      "updatedAt": "2026-10-16T12:00:00.000Z"
    }
  ],
  "simpleNotes": [],
  "entities": [
    {
      "id": "b_001",
      "subject": "math",
      "kind": "question",
      "subKind": "",
      "label": "例题",
      "aCards": [{"id": "card_001", "aObjectId": "a_001", "role": "question", "children": []}],
      "aObjectRefs": [{"aObjectId": "a_001", "role": "question"}],
      "aObjectIds": ["a_001"],
      "status": "active",
      "createdAt": "2026-10-16T12:00:00.000Z",
      "updatedAt": "2026-10-16T12:00:00.000Z"
    }
  ],
  "collections": []
}
```

示例中的学科、类型与 role 需符合实际使用的学科 schema。

## 6. Entity

本次不改变 Entity 数据结构，也不改变 Entity、A Object、A Card 的 ID。

- aCards：有序引用树，节点含 `id`、`aObjectId`、`role`、`children`。
- aObjectRefs/aObjectIds：现有兼容扁平表示，保存时继续同步。
- Entity 自身的 subject/kind/subKind/label/featureValues 等保持原样。
- Entity 的成员可以指向同一来源文件的不同视频时间或 PDF 页面。

## 7. 直接定位与画面资源

关系为 `Entity → A Card → A Object → sourceId + locator → Source`。

- 磁盘 v2 → hydrateAnnotationDocument → 仍为 sourceId + locator 的内存数据，不重建 frames/frameId/timeStamp。
- 旧文件 → 读取原 Frame 定位 → 转成 v2 A Object → 丢弃旧 Frame。
- 内存数据 → serializeAnnotationDocument → 同样不带 F 的磁盘 v2。
- 同一来源文件的同一画面通过缓存键共享图片资源，视频保留精确时间，PDF 使用物理页码。
- 缓存键由文件名/指纹、来源类型、视频时间或 PDF 物理页码生成，不使用 Frame ID。
- 编辑器仅保存当前视频时间、PDF 页码和页面尺寸等显示状态，以及图片资源缓存。
- PDF 页面由查看器按需渲染；视频通过实际 seeked 事件或截图服务获取对应画面。
- 界面移除 Frame 列表及其 Go To、ID、详情入口。A Object 显示自身视频时间或 PDF 页码。
- 原“绑定到当前 Frame”改为“Set To Current Video Time”，直接修改所选 A Object.locator.time。
- 整个画面可视为 `(0,0,1,1)` 的虚拟 Rect，不自动增加到 annotations，也不增加 Entity 成员。

绘图层直接接收 sourceId 与 locator；GO TO、预览及裁剪导出直接解析 A Object 的位置。PDF 连续模式仍按页隔离交互。图片资源仅为 Canvas/截图及其尺寸，不具有可管理的 F 身份。

## 8. 版本判断和迁移

| schemaVersion | 读取方式 |
| --- | --- |
| 缺失 | 作为早期 v1 校验并读取 |
| 数字 1 | 从旧 Frame 解析定位，转为不含 F 的 v2 数据 |
| 数字 2 | 校验并直接使用 A Object.sourceId/locator |
| 其他值 | 返回 unsupported-annotation-schema-version，禁止误写 |

v1 视频迁移优先级：`frame.locator.time` → `frame.timeStamp` → `annotation.timeStamp`。保留精度，不能直接用可能偏差的 A Object 时间覆盖 Frame 时间。

v1 PDF 从 `frame.locator.physicalPage`（兼容 `page`）获取物理页码，从 `frame.meta.bookPageLabel` 获取书籍标签；禁止默认补成第 1 页。

早期版本曾在重开视频时重建 Source ID、但保留旧 Frame.sourceId。对于只有一个来源的 v1 文件，可明确回退到该唯一来源；多来源文件不猜测缺失的来源。

读取只在内存转换。用户保存时写入 v2，不进行文件夹批量迁移。旧版 lab 不保证能读取 v2。SimpleNotes、Entity 内容和引用 ID 不做迁移改写。

## 9. 实现入口与错误处理

- `src/shared/annotationDocument.js`：版本检查、hydrate、serialize；不依赖 Electron/DOM。
- `src/shared/mediaLocation.js`：直接定位、缓存键与当前画面匹配；不创建 Frame。
- `src/main/main.js`：B 文件打开、旁路加载、Source 读取、索引版本检查、保存和原始保存入口。
- `src/renderer/ab-editor/abEditorLoader.js`：来源 ID 维持稳定、新旧数据加载、保存前转换。
- CEditor 经现有 loadAnnotationFileByPath 获取统一 v2 数据，Source/Selected/Composite 预览及导出直接读取 A Object.locator。
- readAnnotationFileRaw 返回磁盘结构（只检查版本）；saveAnnotationFileRaw 也必须经 serializer，不能写回旧 frames。

缺失来源、PDF 页码无效、视频时间无效会报出对应错误；序列化验证在写盘前完成，格式错误时不覆盖原文件。直接打开来源文件时，如果旁边的笔记文件损坏或版本不支持，返回加载失败，不能悄悄新建空笔记。

## 10. 验证

自动验证命令（只运行纯数据测试，不运行桌面应用）：

```text
node --test --experimental-test-isolation=none src/shared/annotationDocument.test.js src/shared/annotationDocument.integration.test.js src/shared/mediaLocation.test.js src/shared/entityPreviewLocation.test.js
```

覆盖视频精确时间迁移、PDF 双页码、图片、无版本号旧文件、同画面缓存键共享、重新定位后保存、旧 Source ID 不一致、缺失定位/未知版本拒绝保存；另验证三种媒体会话没有 F 数据、保存接口只发送 v2、损坏的相邻笔记不回退成空会话，以及 CEditor 的 PDF/视频/旧文件预览定位。

手动回归：分别打开旧图片/视频/PDF 笔记 → 检查 A Object 和 Entity → 保存 → 检查 JSON 为 v2 且无 frames/frameId/timeStamp → 重开 → GO TO、预览、改绑和裁剪导出；再在 CEditor 检查 Source、Selected、Composite Preview、Export All。PDF 同时检查单页/连续模式及两种页码。

## 11. 变更记录

| 日期 | 版本 | 内容 |
| --- | --- | --- |
| 2026-10-16 | 2 | 移除持久化 Frame，A Object 直接保存 sourceId/locator；兼容 v1 读取 |
| 2026-10-16 | 2（运行时重构） | 移除运行时 Frame、Frame ID 与界面入口，直接定位；磁盘 schema 不升级 |
