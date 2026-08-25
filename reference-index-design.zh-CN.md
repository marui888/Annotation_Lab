# Reference Index / 引用索引设计初版

## 1. 背景

当前数据模型中，业务数据主要是单向引用：

```text
Composite Document -> Composite Document
Composite Document -> annotation.json / Entity
Entity -> A Object
```

这种设计比较干净：上层数据引用下层数据，下层数据不需要知道自己被谁引用。  
例如，一个 Entity 被多个 Composite 使用时，Entity 本身不需要保存“被哪些 Composite 使用”。

但是在实际编辑工作流中，会出现一些需要反向依赖信息的场景：

```text
删除 Entity 前，需要知道它是否被 Composite 使用
删除 Composite 前，需要知道它是否被其它 Composite 引用
移动文件或修改路径后，需要知道哪些引用会失效
修复引用路径时，需要批量定位受影响的数据文件
从某个 Entity 反向查看它被哪些讲义、题集、合集使用
```

这些信息不是业务内容本身，而是为了辅助编辑、维护、删除、修复、导航等工作流而产生的数据。

因此，需要增加一个独立的工作流数据层：Reference Index / 引用索引。

## 2. 设计原则

### 2.1 业务数据继续保持单向引用

业务文件中仍然只保存真实内容和正向引用：

```text
.annotation.json
  sources
  frames
  annotations
  entities

.composite.json
  items
    b-ref
    c-ref
    file-ref
    text
```

不把“被谁引用”写回到 Entity、Annotation 或 Composite 本体中。

### 2.2 反向引用属于工作流数据

“某个对象被谁使用”属于索引信息，不属于业务数据。

所以它应该单独保存，例如：

```text
reference-index.json
```

以后数据量变大后，可以迁移到：

```text
reference-index.sqlite
```

### 2.3 第一版先用 JSON

第一版重点验证数据结构和交互逻辑，先使用 JSON 文件保存引用索引，避免过早引入数据库复杂度。

## 3. 索引文件建议位置

第一版可以放在项目或用户指定工作目录中，例如：

```text
reference-index.json
```

以后可以根据实际使用方式调整为：

```text
工作区目录/.note-review/reference-index.json
```

或者：

```text
项目根目录/reference-index.json
```

如果使用 SQLite，可以改为：

```text
reference-index.sqlite
```

## 4. JSON 数据结构初版

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-25T00:00:00.000Z",
  "scopes": [
    {
      "kind": "folder",
      "path": "D:\\notes"
    }
  ],
  "references": [
    {
      "id": "ref_xxx",
      "from": {
        "kind": "composite",
        "filePath": "D:\\notes\\不等式讲义.composite.json",
        "documentId": "c_xxx",
        "itemId": "ci_xxx"
      },
      "to": {
        "kind": "entity",
        "dataFilePath": "D:\\notes\\img001.jpg.annotation.json",
        "entityId": "b_xxx"
      },
      "relation": "contains",
      "createdAt": "2026-08-25T00:00:00.000Z",
      "updatedAt": "2026-08-25T00:00:00.000Z"
    },
    {
      "id": "ref_yyy",
      "from": {
        "kind": "composite",
        "filePath": "D:\\notes\\高中数学复习.composite.json",
        "documentId": "c_yyy",
        "itemId": "ci_yyy"
      },
      "to": {
        "kind": "composite",
        "filePath": "D:\\notes\\不等式讲义.composite.json",
        "documentId": "c_xxx"
      },
      "relation": "contains",
      "createdAt": "2026-08-25T00:00:00.000Z",
      "updatedAt": "2026-08-25T00:00:00.000Z"
    }
  ]
}
```

## 5. 引用类型

第一版重点支持两类核心引用。

### 5.1 Composite 引用 Entity

业务数据示意：

```json
{
  "type": "b-ref",
  "ref": {
    "dataFilePath": "D:\\notes\\img001.jpg.annotation.json",
    "sourceFilePath": "D:\\notes\\img001.jpg",
    "entityId": "b_xxx"
  }
}
```

索引记录：

```json
{
  "from": {
    "kind": "composite",
    "filePath": "D:\\notes\\不等式讲义.composite.json",
    "documentId": "c_xxx",
    "itemId": "ci_xxx"
  },
  "to": {
    "kind": "entity",
    "dataFilePath": "D:\\notes\\img001.jpg.annotation.json",
    "entityId": "b_xxx"
  },
  "relation": "contains"
}
```

### 5.2 Composite 引用 Composite

业务数据示意：

```json
{
  "type": "c-ref",
  "ref": {
    "filePath": "D:\\notes\\不等式题目汇总.composite.json",
    "documentId": "c_abc"
  }
}
```

索引记录：

```json
{
  "from": {
    "kind": "composite",
    "filePath": "D:\\notes\\高中数学复习.composite.json",
    "documentId": "c_yyy",
    "itemId": "ci_yyy"
  },
  "to": {
    "kind": "composite",
    "filePath": "D:\\notes\\不等式题目汇总.composite.json",
    "documentId": "c_abc"
  },
  "relation": "contains"
}
```

## 6. 后续可扩展引用

以后可以继续扩展：

```text
Composite -> text file
Composite -> image file
Composite -> video file
Composite -> annotation source file
Entity -> A Object
Composite -> Composite item
```

这些引用可以统一放入 `references` 数组中，通过 `from.kind`、`to.kind` 和 `relation` 区分。

## 7. 索引生成方式

### 7.1 第一版：手动重建索引

提供一个命令或按钮：

```text
Rebuild Reference Index
```

用户指定一个或多个扫描范围：

```text
一个文件夹
多个文件夹
一个 composite 文件
多个 composite 文件
```

程序扫描：

```text
*.composite.json
*.annotation.json
```

然后生成完整引用索引。

### 7.2 后续：增量更新索引

以后可以在这些操作后自动更新索引：

```text
保存 Composite
删除 Entity
删除 Composite
移动文件
修复引用
重命名文件
```

这样可以减少每次全量扫描的成本。

## 8. 查询场景

### 8.1 查询 Entity 被谁引用

查询条件：

```text
to.kind === "entity"
to.dataFilePath === 当前 annotation.json 路径
to.entityId === 当前 Entity ID
```

结果可以显示：

```text
这个 Entity 被 3 个 Composite 使用：

1. 不等式讲义.composite.json
2. 高一复习.composite.json
3. 错题整理.composite.json
```

### 8.2 查询 Composite 被谁引用

查询条件：

```text
to.kind === "composite"
to.filePath === 当前 composite 文件路径
```

结果可以显示：

```text
这个 Composite 被 2 个 Composite 使用：

1. 高中数学复习.composite.json
2. 期末复习讲义.composite.json
```

## 9. 删除前检查交互

### 9.1 删除 Entity

用户删除 Entity 前：

```text
1. 查询 Reference Index
2. 如果没有被引用，允许删除
3. 如果被引用，显示确认对话框
```

对话框示意：

```text
This Entity is used by 3 Composite documents.

1. 不等式讲义.composite.json
2. 高一复习.composite.json
3. 错题整理.composite.json

[Cancel] [Delete Anyway]
```

后续可以增加：

```text
Open References
Repair References
Remove References Then Delete
```

### 9.2 删除 Composite

用户删除 Composite 前：

```text
1. 查询 Reference Index
2. 如果没有被引用，允许删除
3. 如果被其它 Composite 引用，显示确认对话框
```

## 10. 引用修复交互

引用索引也可以辅助路径修复：

```text
1. 扫描出失效引用
2. 显示失效路径
3. 用户选择新目录或新文件
4. 批量修复
5. 更新业务文件
6. 更新引用索引
```

这和当前 Composite Preview 中的 reference repair 功能可以逐步合并。

## 11. 与业务数据模型的关系

可以把当前系统分成两类数据：

```text
业务数据：
  Alpha / Source
  A Object
  B Entity
  C Composite

工作流数据：
  Reference Index
  Recent Files
  Recent Folders
  UI Session State
  Settings
```

Reference Index 不改变业务数据模型，只提供工作流能力。

## 12. SQLite 迁移方向

当引用数量变大后，可以把 JSON 迁移到 SQLite。

核心表可以设计为：

```sql
CREATE TABLE references (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL,
  from_file_path TEXT NOT NULL,
  from_document_id TEXT,
  from_item_id TEXT,
  to_kind TEXT NOT NULL,
  to_file_path TEXT,
  to_data_file_path TEXT,
  to_document_id TEXT,
  to_entity_id TEXT,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

常用索引：

```sql
CREATE INDEX idx_references_to_entity
ON references (to_kind, to_data_file_path, to_entity_id);

CREATE INDEX idx_references_to_composite
ON references (to_kind, to_file_path, to_document_id);
```

## 13. 初版实施步骤

### 阶段 1：索引数据结构

实现：

```text
reference-index.json 数据结构
引用记录生成函数
引用记录查询函数
```

### 阶段 2：扫描 Composite

实现：

```text
扫描 .composite.json
提取 b-ref
提取 c-ref
生成 references
```

### 阶段 3：删除前检查

实现：

```text
删除 Entity 前查询索引
删除 Composite 前查询索引
显示被引用列表
```

### 阶段 4：引用修复整合

实现：

```text
失效引用扫描
引用路径批量修复
修复后更新 reference-index.json
```

### 阶段 5：SQLite 评估

当 JSON 索引变大或查询变慢后，再迁移 SQLite。

## 14. 初版结论

业务数据继续保持单向引用，Reference Index 作为独立的工作流索引存在。

这样可以同时满足：

```text
业务模型干净
删除前可以检查反向引用
路径修复有依据
可以从下层数据反向导航到上层数据
以后可以平滑迁移 SQLite
```

