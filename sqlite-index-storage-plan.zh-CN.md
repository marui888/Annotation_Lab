# JSON 与 SQLite 存储方案

## 核心判断

当前项目中的 annotation / composite 数据已经使用 JSON 文件保存。  
如果现在把所有 JSON 数据一次性改成数据库主存储，风险会比较高。

更稳妥的第一版方案是：

```text
JSON = 主数据
SQLite = 索引 / 查询 / 反向引用 / 缓存
```

也就是说：

```text
JSON 文件仍然是权威数据源。
SQLite 数据库保存可重建的索引数据。
```

这样做的好处是：

```text
1. 不破坏现有 JSON 文件工作流。
2. 数据仍然容易复制、备份、人工查看和恢复。
3. SQLite 可以承担跨文件查询、反向引用、失效检测等复杂功能。
4. 数据库损坏时，可以重新扫描 JSON 文件重建。
```

## JSON 文件的优势

JSON 继续作为主数据，有几个现实优势：

```text
1. 一个媒体文件对应一个 annotation 文件，关系直观。
2. 文件容易复制、移动、备份。
3. 方便人工查看和调试。
4. 适合零碎编辑和逐步完善。
5. 不依赖数据库服务或复杂迁移机制。
```

例如：

```text
abc.jpg
abc.jpg.annotation.json

abc.mp4
abc.mp4.annotation.json
```

Composite 文件也继续保持独立：

```text
不等式题目.composite.json
高一数学复习.composite.json
```

## SQLite 的优势

SQLite 更适合承担这些功能：

```text
1. 跨文件查询。
2. 根据 subject / kind / feature 过滤 Entity。
3. 查找某个 Entity 被哪些 Composite 使用。
4. 查找 relation 关系。
5. 检测失效引用。
6. 为 Source Pool / Pick Dialog 提供快速数据源。
7. 建立全局 reference index。
```

所以第一阶段不要让 SQLite 取代 JSON，而是让 SQLite 成为查询层和索引层。

## 第一阶段：明确数据库职责

SQLite 第一版只保存可以从 JSON 重建的数据。

主要包括：

```text
source_files
annotation_files
frames
a_objects
entities
entity_a_refs
entity_relations
composite_files
composite_items
file_refs
back_refs
```

这些数据都是索引数据，不是唯一主数据。

如果数据库丢失，可以通过：

```text
Scan Folder
Rebuild Index
```

重新生成。

## 第二阶段：SQLite 表结构草案

### source_files

保存源文件信息，例如图片、视频、PDF。

```sql
source_files
- id
- file_path
- file_type
- file_name
- folder_path
- media_hash
- created_at
- updated_at
```

### annotation_files

保存 annotation 文件信息。

```sql
annotation_files
- id
- file_path
- source_file_id
- schema_version
- updated_at
```

### frames

保存视频帧或图片帧信息。

图片通常只有一帧。  
视频可以有多个 frame。

```sql
frames
- id
- annotation_file_id
- frame_id
- media_time
- width
- height
```

### a_objects

保存 A 层对象索引。

```sql
a_objects
- id
- annotation_file_id
- frame_id
- type
- locator_json
- geometry_json
- text
- created_at
- updated_at
```

说明：

```text
locator_json：保存源位置，例如视频时间、图片坐标等。
geometry_json：保存 Rect / Arrow / Text 等几何数据。
```

### entities

保存 B 层 Entity 索引。

```sql
entities
- id
- annotation_file_id
- subject
- kind
- label
- features_json
- status
- created_at
- updated_at
```

说明：

```text
subject：math / english / ...
kind：problem / solution / translation / grammar / ...
features_json：主题特征属性。
```

### entity_a_refs

保存 Entity 内部对 A Object 的引用树。

```sql
entity_a_refs
- id
- entity_id
- a_object_id
- parent_ref_id
- order_index
- role
- extra_json
```

这里的 `role` 是关联属性，不是 A Object 本体属性。

也就是说：

```text
A Object 本体没有 role。
Entity 内部引用 A Object 时，这个引用节点有 role。
```

### entity_relations

保存 Entity 与 Entity 之间的关系。

```sql
entity_relations
- id
- from_entity_id
- to_entity_id
- relation_type
- note
- created_at
```

例如：

```text
variant-of
same-model-as
uses-method
explains
confusable-with
requires-knowledge
```

第一版如果 relation 只保存在某个 annotation 文件中，可以先只支持同文件 Entity 关系。  
跨文件关系以后再扩展。

### composite_files

保存 Composite 文件索引。

```sql
composite_files
- id
- file_path
- title
- subject
- kind
- status
- updated_at
```

### composite_items

保存 Composite 内部 item 的有序树。

```sql
composite_items
- id
- composite_file_id
- parent_item_id
- order_index
- item_type
- ref_file_path
- ref_entity_id
- text
- extra_json
```

item_type 可以包括：

```text
b-ref
text
file-ref
c-ref
```

### back_refs

保存反向引用索引。

```sql
back_refs
- id
- target_type
- target_file_path
- target_entity_id
- owner_type
- owner_file_path
- owner_item_id
```

用途：

```text
1. 查某个 Entity 被哪些 Composite 使用。
2. 删除某个 Entity 前提示用户。
3. 文件路径失效时找出受影响的 Composite。
4. 支持引用修复工具。
```

## 第三阶段：建立同步机制

每次保存 JSON 后：

```text
1. 写 JSON 文件。
2. 解析 JSON。
3. 更新 SQLite 索引。
```

打开 APP 时：

```text
1. 检查 SQLite 数据库是否存在。
2. 检查 JSON 文件是否比数据库记录更新。
3. 如果 JSON 更新，则重新索引对应文件。
4. 如果数据库不存在，则提示或自动执行 Rebuild Index。
```

需要提供几个工具：

```text
Rebuild Index
Scan Folder
Check Broken References
Find Back References
```

## 第四阶段：查询功能先走数据库

SQLite 建好后，下面这些 UI 功能可以逐步改为从数据库查询：

```text
1. Source Pool
2. Pick Dialog
3. Composite Source 选择器
4. Entity 过滤器
5. Relation 查询
6. Broken Reference 检测
7. Back Reference 查询
```

典型查询包括：

```text
按 subject / kind / feature 查询 Entity。
查某个 source 文件下所有 Entity。
查某个 Entity 被哪些 Composite 引用。
查所有 missing file refs。
查 same-model-as / variant-of 关系。
查某个知识点关联的题目。
```

## 第五阶段：再考虑数据库主存储

等数据模型稳定以后，才考虑是否升级为：

```text
SQLite = 主存储
JSON = 导入 / 导出格式
```

那时保存流程会变成：

```text
用户编辑
-> 写 SQLite
-> 按需导出 JSON
```

但是这个阶段需要更谨慎，因为会引入：

```text
1. 事务。
2. 迁移。
3. 备份。
4. 并发。
5. 数据库损坏恢复。
6. 文件移动后的路径修复。
7. 跨机器同步。
```

所以不建议当前阶段直接这样做。

## 推荐实施顺序

```text
1. 保持 JSON 为主数据，不破坏现有工作流。
2. 新增 SQLite index database。
3. 实现 annotation.json -> SQLite 索引。
4. 实现 composite.json -> SQLite 索引。
5. Source Pool / Pick Dialog 改为从 SQLite 查询。
6. 实现 Back References 查询。
7. 实现 Broken References 检测。
8. 再评估是否切换为 SQLite 主存储。
```

## 总结

第一版推荐：

```text
JSON 主存储 + SQLite 索引数据库
```

这能立刻解决跨文件查询、反向引用、过滤、失效检测等问题，同时保留 JSON 文件简单、透明、好恢复的优点。

