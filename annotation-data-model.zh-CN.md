# Annotation Lab 数据模型

## 1. ID 生成策略

ID 建议使用 UUID 风格的全局唯一 ID。优先使用浏览器/Electron 内置 API：

```js
crypto.randomUUID()
```

不要使用纯时间戳 ID，也不要使用简单自增 ID。原因是本项目中的对象需要长期持久化，并且会被其它层对象引用；以后还可能涉及导入、导出、合并、迁移、跨文件索引等场景。

建议封装一个小函数：

```js
export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`
}
```

推荐前缀：

```text
src_    Source，原始数据源对象
frame_  α 层画面引用对象
a_      A 层几何标注对象
b_      B 层主题语义对象
c_      C 层集合、查询、输出对象
tag_    标签对象
```

这样既保证全局唯一，又能从 ID 前缀大致看出对象所属层次。

## 2. 总体分层

项目中的持久化数据建议分为以下几类：

```text
Source       原始数据源
FrameRef     α 层画面定位
AAnnotation  A 层几何标注
BEntity      B 层主题语义对象
CItem        C 层使用、集合、输出对象
```

整体关系：

```text
Source 1 -> N FrameRef
FrameRef 1 -> N AAnnotation
AAnnotation N -> N BEntity
BEntity N -> N CItem
```

C 层可以这样回溯到原始介质：

```text
CItem
-> BEntity
-> AAnnotation
-> FrameRef
-> Source
-> α 层 Adapter 打开正确的文件、页码或时间点
```

## 3. Source：原始数据源

`Source` 表示一个原始输入文件，例如图片、视频、PDF、TXT、MD 等。

```json
{
  "id": "src_uuid",
  "kind": "image",
  "filePath": "D:/data/a.png",
  "fileName": "a.png",
  "fingerprint": {
    "size": 123456,
    "mtimeMs": 1780000000
  },
  "meta": {
    "width": 1920,
    "height": 1080,
    "duration": null,
    "pageCount": null
  },
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

说明：

- `kind` 可以是 `image`、`video`、`pdf`、`text`、`markdown` 等。
- `fingerprint` 用于判断源文件是否可能被修改过。
- `meta` 存放不同源文件类型的元数据，例如图片宽高、视频时长、PDF 页数。

## 4. FrameRef：α 层画面定位

`FrameRef` 表示 α 层提供给 A 层标注的一张“画面”。

图片：

```json
{
  "id": "frame_uuid",
  "sourceId": "src_uuid",
  "kind": "image",
  "locator": {}
}
```

视频：

```json
{
  "id": "frame_uuid",
  "sourceId": "src_uuid",
  "kind": "video",
  "locator": {
    "time": 123.456
  }
}
```

PDF：

```json
{
  "id": "frame_uuid",
  "sourceId": "src_uuid",
  "kind": "pdf",
  "locator": {
    "pageIndex": 12
  }
}
```

说明：

- A 层只依赖 `frameId`。
- A 层不关心这个 frame 来自图片、视频还是 PDF。
- TXT、MD 这类文本文件可以不经过 A 层，直接进入 B 层或 C 层。

## 5. AAnnotation：A 层几何标注

`AAnnotation` 是画面上的几何对象，只描述视觉位置和形状，不包含数学、英语等主题语义。

矩形框：

```json
{
  "id": "a_uuid",
  "frameId": "frame_uuid",
  "type": "rect",
  "geometry": {
    "x": 0.12,
    "y": 0.2,
    "width": 0.3,
    "height": 0.15
  },
  "text": "",
  "style": {
    "stroke": "#ffd45a",
    "fill": "rgba(255, 212, 90, 0.12)",
    "strokeWidth": 2
  },
  "status": "active",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

点标记：

```json
{
  "id": "a_uuid",
  "frameId": "frame_uuid",
  "type": "point",
  "geometry": {
    "x": 0.45,
    "y": 0.62
  },
  "status": "active"
}
```

文本标记：

```json
{
  "id": "a_uuid",
  "frameId": "frame_uuid",
  "type": "text",
  "geometry": {
    "x": 0.3,
    "y": 0.4
  },
  "text": "重点",
  "status": "active"
}
```

坐标规则：

- 几何坐标使用归一化坐标保存。
- `x`、`y`、`width`、`height` 都是相对于当前可见画面区域的比例。
- 这样窗口缩放、图片缩放、视频保持宽高比显示时，标注仍然能贴合画面。

## 6. BEntity：B 层主题语义对象

`BEntity` 是带主题语义的领域对象。它引用一个或多个 A 层标注对象。

数学例子：

```json
{
  "id": "b_uuid",
  "theme": "math",
  "entityType": "question",
  "title": "函数单调性例题",
  "parts": [
    {
      "role": "stem",
      "annotationIds": ["a_001"]
    },
    {
      "role": "answer",
      "annotationIds": ["a_002"]
    },
    {
      "role": "analysis",
      "annotationIds": ["a_003", "a_004"]
    }
  ],
  "tags": ["函数", "单调性", "易错"],
  "note": "",
  "status": "incomplete",
  "validation": {
    "missingRoles": []
  },
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

英语例子：

```json
{
  "id": "b_uuid",
  "theme": "english",
  "entityType": "translationItem",
  "parts": [
    {
      "role": "source",
      "annotationIds": ["a_010"]
    },
    {
      "role": "translation",
      "annotationIds": ["a_011"]
    },
    {
      "role": "grammar",
      "annotationIds": ["a_012"]
    }
  ],
  "tags": ["定语从句", "长难句"],
  "note": "",
  "status": "active"
}
```

说明：

- B 层不直接保存几何坐标。
- B 层通过 `annotationIds` 引用 A 层对象。
- 主题相关规则不应该写死在 UI 事件中，而应该来自主题 schema。

## 7. CItem：C 层使用对象

`CItem` 表示 C 层的使用结果，例如集合、讲义草稿、习题集、句型本等。

```json
{
  "id": "c_uuid",
  "type": "collection",
  "title": "函数易错题",
  "entityIds": ["b_001", "b_008"],
  "tags": ["讲义", "复习"],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

规则：

- C 层通常应该引用 B 层对象，而不是直接引用 A 层标注。
- 查询结果本身不一定需要持久化。
- 收藏集、讲义草稿、习题集、句型本等需要持久化。

## 8. 可选的 Relation 关系表

第一版可以使用内嵌引用：

```text
AAnnotation.frameId
BEntity.parts[].annotationIds
CItem.entityIds
```

暂时不需要单独的关系表。

如果以后关系变复杂，例如关系本身需要权重、顺序、说明、可信度等元数据，再添加显式 Relation 模型：

```json
{
  "id": "rel_uuid",
  "fromType": "annotation",
  "fromId": "a_001",
  "toType": "entity",
  "toId": "b_001",
  "role": "stem"
}
```

## 9. 持久化文件结构

lab 第一版可以采用“一个源文件对应一个 annotation json 文件”的方式。

图片：

```text
abc.png.annotation.json
```

视频：

```text
abc.mp4.annotation.json
```

建议 JSON 结构：

```json
{
  "schemaVersion": 1,
  "sources": [],
  "frames": [],
  "annotations": [],
  "entities": [],
  "collections": []
}
```

以后如果需要跨文件查询，可以再把这些 JSON 文件扫描并索引到 SQLite。

## 10. 设计边界

关键边界：

```text
α 层：隔离图片、视频、PDF、文本等来源差异。
A 层：只绑定 frameId，只保存几何标注。
B 层：引用 annotationIds，并应用主题 schema。
C 层：引用 entityIds，提供查询、整理、导出等工作流。
```

系统必须支持增量式工作：

```text
创建或修改 A 层标注。
创建或修改 B 层语义对象。
使用 C 层查询和集合。
从 C 回跳到 B，从 B 回跳到 A。
```

A/B/C 不是瀑布流程。用户会在多个层之间不断切换，一点一点补充、修改和完善数据。
