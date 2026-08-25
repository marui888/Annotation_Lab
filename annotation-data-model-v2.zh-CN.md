# Annotation Lab 数据模型 v2

本文档整理 `prj_annotation_lab` 当前阶段已经实际实现的数据模型。

第一版文档 `annotation-data-model.zh-CN.md` 描述的是初始设计。当前实现仍然保留它的分层思想，但在 B 层和 C 层上已经做了明显演化：

```text
Source / FrameRef / AAnnotation / BEntity / CDocument
```

当前有两类主要持久化文件：

```text
源文件.annotation.json    保存 Source、Frame、A 数据、B 数据
*.composite.json                  保存 C 层文档
```

---

## 1. ID 规则

ID 使用浏览器 / Electron 内置的 `crypto.randomUUID()`，通过 `createId(prefix)` 封装。

当前前缀约定：

```text
src_     Source
frame_   FrameRef
a_       AAnnotation
b_       BEntity
card_    BEntity 内部的 A Card
c_       CDocument
ci_      CDocument 内部的 CItem
editor_  编辑器 Session，属于 UI 状态
load_    加载请求，属于 UI 状态
```

`editor_`、`load_` 是交互状态 ID，不属于长期领域数据。

---

## 2. 总体分层

当前模型可以理解为：

```text
Source
  ↓
FrameRef
  ↓
AAnnotation
  ↓
A Card Tree
  ↓
BEntity
  ↓
CItem Tree
  ↓
CDocument
```

核心边界：

```text
Source      原始文件。
FrameRef    α 层画面定位。
AAnnotation A 层几何标注，只描述画面中的位置、形状、文本。
BEntity     B 层主题语义对象，引用 AAnnotation。
CDocument   C 层组合文档，引用 BEntity、外部文件、文本、其它 CDocument。
```

---

## 3. Annotation 数据文件

一个图片、视频、PDF 等源文件，对应一个 annotation 数据文件。

当前图片模式已经实现，视频/PDF 以后可复用同一结构。

文件名：

```text
abc.png.annotation.json
abc.mp4.annotation.json
abc.pdf.annotation.json
```

顶层结构：

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

字段说明：

```text
sources      Source 列表。
frames       FrameRef 列表。
annotations  A 层标注对象列表。
entities     B 层 Entity 列表。
collections  预留字段，当前未实际使用。
```

---

## 4. Source

`Source` 表示原始输入文件。

当前实际实现主要是图片：

```json
{
  "id": "src_xxx",
  "kind": "image",
  "filePath": "D:/data/example.png",
  "fileName": "example.png",
  "fileUrl": "lab-file://local/...",
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

```text
kind        当前主要是 image。未来可以扩展 video、pdf、text、markdown。
fileUrl     当前用于 renderer 显示本地文件，使用 lab-file 协议。
fingerprint 用于判断源文件是否可能发生变化。
meta        存放媒体元数据。
```

---

## 5. FrameRef

`FrameRef` 是 α 层提供给 A 层的一张“画面”。

图片：

```json
{
  "id": "frame_xxx",
  "sourceId": "src_xxx",
  "kind": "image",
  "locator": {}
}
```

未来视频可以是：

```json
{
  "id": "frame_xxx",
  "sourceId": "src_xxx",
  "kind": "video",
  "locator": {
    "time": 123.456
  }
}
```

未来 PDF 可以是：

```json
{
  "id": "frame_xxx",
  "sourceId": "src_xxx",
  "kind": "pdf",
  "locator": {
    "pageIndex": 12
  }
}
```

当前实现中，图片只有一个 frame。

---

## 6. AAnnotation

`AAnnotation` 是 A 层几何标注数据。

它只保存画面上的形状、位置、文本和样式，不保存数学、英语等主题语义。

当前支持：

```text
rect
arrow
text
```

第一版文档中的 `point` 已经在当前实现中演化为 `arrow`。

### 6.1 Rect

```json
{
  "id": "a_xxx",
  "frameId": "frame_xxx",
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

### 6.2 Arrow

```json
{
  "id": "a_xxx",
  "frameId": "frame_xxx",
  "type": "arrow",
  "geometry": {
    "x1": 0.1,
    "y1": 0.2,
    "x2": 0.4,
    "y2": 0.5
  },
  "text": "",
  "style": {
    "stroke": "#ff4d4d",
    "fill": "#ff4d4d",
    "strokeWidth": 3,
    "pointerLength": 12,
    "pointerWidth": 12
  },
  "status": "active",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

### 6.3 Text

```json
{
  "id": "a_xxx",
  "frameId": "frame_xxx",
  "type": "text",
  "geometry": {
    "x": 0.3,
    "y": 0.4,
    "width": 0.2,
    "height": 0.08
  },
  "text": "FreeText",
  "style": {
    "fill": "#ff4d4d",
    "fontSize": 18
  },
  "status": "active",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

坐标规则：

```text
所有 geometry 坐标都使用归一化坐标。
归一化坐标相对于当前 frame 的原始画面尺寸。
窗口缩放、Fit、100%、Zoom 不改变持久化坐标。
```

---

## 7. BEntity

`BEntity` 是 B 层主题语义对象。

第一版设计中，BEntity 使用 `parts[]`：

```json
{
  "theme": "math",
  "entityType": "question",
  "title": "题目1",
  "parts": [
    {
      "role": "stem",
      "annotationIds": ["a_xxx"]
    }
  ]
}
```

当前第二版实际模型已经改为：

```json
{
  "id": "b_xxx",
  "subject": "math",
  "kind": "question",
  "label": "题目1",
  "aCards": [],
  "aObjectRefs": [],
  "aObjectIds": [],
  "status": "active",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

字段映射：

```text
theme       -> subject
entityType  -> kind
title       -> label
parts       -> aCards
```

---

## 8. A Card Tree

`aCards` 是当前 BEntity 的主数据。

它是一个有序树，而不是简单数组。

```json
{
  "id": "card_xxx",
  "aObjectId": "a_xxx",
  "role": "stem",
  "children": []
}
```

完整示例：

```json
{
  "id": "b_xxx",
  "subject": "math",
  "kind": "question",
  "label": "函数题 1",
  "aCards": [
    {
      "id": "card_001",
      "aObjectId": "a_stem",
      "role": "stem",
      "children": [
        {
          "id": "card_002",
          "aObjectId": "a_answer",
          "role": "answer",
          "children": []
        }
      ]
    }
  ],
  "aObjectRefs": [
    {
      "aObjectId": "a_stem",
      "role": "stem"
    },
    {
      "aObjectId": "a_answer",
      "role": "answer"
    }
  ],
  "aObjectIds": ["a_stem", "a_answer"]
}
```

约定：

```text
aCards 是主数据。
aObjectRefs 是由 aCards 深度优先展开得到的兼容字段。
aObjectIds 是由 aObjectRefs 派生出的兼容字段。
```

保存时会重新生成兼容字段，保证旧逻辑和索引扫描仍可工作。

---

## 9. B 层主题 Schema

当前主题 schema 写在代码中。

已实现主题：

```text
math
english
```

数学主题：

```text
question
stem
answer
analysis
knowledge-point
summary
```

英语主题：

```text
original
translation
sentence
word
grammar
knowledge-point
```

当前校验规则：

```text
math/question      至少包含 role = stem 的 A Card。
english/translation 至少包含 role = original 的 A Card。
每个 Entity 至少包含 1 个 A Object。
```

当前校验只检查 role 是否存在；还没有实现复杂树层级规则。

---

## 10. CDocument 文件

C 层数据独立保存为 `.composite.json` 文件。

示例文件名：

```text
不等式_题目汇总.composite.json
不等式_讲义.composite.json
高中数学复习.composite.json
```

顶层结构：

```json
{
  "schemaVersion": 1,
  "id": "c_xxx",
  "title": "Untitled",
  "subject": "mixed",
  "kind": "collection",
  "items": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

当前 CDocument subject：

```text
mixed
math
english
```

当前 CDocument kind：

```text
collection
lecture
review
exercise-set
```

---

## 11. C Item Tree

`items` 是 CDocument 的核心内容。

当前已经是树结构：

```json
{
  "id": "ci_xxx",
  "type": "...",
  "children": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

支持的 item 类型：

```text
b-ref
text
file-ref
c-ref
```

---

## 12. CItem: b-ref

`b-ref` 引用某个 annotation 数据文件中的 BEntity。

```json
{
  "id": "ci_xxx",
  "type": "b-ref",
  "ref": {
    "dataFilePath": "D:/data/example.png.annotation.json",
    "sourceFilePath": "D:/data/example.png",
    "entityId": "b_xxx"
  },
  "snapshot": {
    "subject": "math",
    "kind": "question",
    "label": "题目1",
    "aObjectCount": 3,
    "ruleOk": true,
    "issues": []
  },
  "children": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

说明：

```text
ref 是真实引用。
snapshot 是创建 CItem 时保存的摘要，便于列表展示。
真实预览时仍会读取 dataFilePath，再找到 entityId 对应的 BEntity。
```

---

## 13. CItem: text

`text` 是用户直接写入 CDocument 的文字内容。

```json
{
  "id": "ci_xxx",
  "type": "text",
  "text": "用户自己写的一段说明。",
  "children": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

---

## 14. CItem: file-ref

`file-ref` 引用外部文件。

当前支持：

```text
fileKind = text
fileKind = image
```

示例：

```json
{
  "id": "ci_xxx",
  "type": "file-ref",
  "fileKind": "image",
  "ref": {
    "filePath": "D:/data/example.png"
  },
  "display": {
    "title": "example.png",
    "mode": "inline"
  },
  "children": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

---

## 15. CItem: c-ref

`c-ref` 引用另一个 CDocument。

```json
{
  "id": "ci_xxx",
  "type": "c-ref",
  "ref": {
    "cFilePath": "D:/data/另一个讲义.composite.json",
    "mode": "live"
  },
  "display": {
    "title": "另一个讲义.composite.json",
    "mode": "inline"
  },
  "children": [],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

当前约定：

```text
mode = live 表示预览时读取被引用的 CDocument 当前内容。
预览中做循环引用检测。
预览中限制最大递归深度。
```

---

## 16. TreeList 复用

当前有两种树：

```text
BEntity.aCards
CDocument.items
```

二者都复用同一个通用 `TreeList`。

TreeList 只要求节点满足：

```json
{
  "id": "node-id",
  "children": []
}
```

业务含义由外层组件通过 `renderNode` 注入。

---

## 17. 非持久化 UI 状态

以下状态目前属于 UI / Session 状态，不写入 `.annotation.json` 或 `.composite.json`：

```text
当前打开的 workspace tab
当前打开的 ABEditor session 列表
当前选中的 AAnnotation
当前选中的 BEntity
当前选中的 CItem
当前工具模式 rect/arrow/text/select
当前 zoom / fit 状态
左右面板宽度
Preview 背景颜色
右键菜单状态
Dialog 状态
```

这些状态未来如果需要“恢复上次工作现场”，应该放入单独的 session-state 文件，而不是混入领域数据文件。

---

## 18. 与第一版模型的主要差异

### A 层

```text
第一版：rect / point / text
当前版：rect / arrow / text
```

### B 层

```text
第一版：BEntity.parts[]
当前版：BEntity.aCards[] 有序树
```

字段命名变化：

```text
theme       -> subject
entityType  -> kind
title       -> label
parts       -> aCards
```

### C 层

```text
第一版：CItem.entityIds[]，偏简单集合模型。
当前版：CDocument.items[]，支持树形组合文档。
```

当前 C 层除了引用 BEntity，还支持：

```text
用户文本
外部 txt/image 文件
其它 CDocument
```

---

## 19. 当前仍未完成的模型方向

以下内容当前还没有完整落地：

```text
video SourceAdapter
pdf SourceAdapter
一个视频多个 FrameRef
一个 PDF 多页 FrameRef
跨文件 SQLite 索引
显式 Relation 模型
复杂 B 层树形 role 规则
完整的 session-state 持久化
```

这些可以作为后续版本的数据模型扩展点。

---

## 20. 总结

当前 v2 模型可以概括为：

```text
.annotation.json
├─ Source / FrameRef
├─ AAnnotation
└─ BEntity
   └─ A Card Tree

.composite.json
└─ CDocument
   └─ C Item Tree
      ├─ b-ref
      ├─ text
      ├─ file-ref
      └─ c-ref
```

其中：

```text
A 层解决“画面上有什么标记”。
B 层解决“这些标记在主题语义中是什么”。
C 层解决“如何组织、引用、复用这些语义对象”。
```

这是当前实现相对于第一版模型的真实状态。
