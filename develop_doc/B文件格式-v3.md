# lab B 文件格式 v3：A 默认属性与 Entity 引用属性

当前最新格式为 [B 文件 v3.1](B文件格式-v3.1.md)。本文保留 v3 的属性设计；当前保存版本为 3.1，视频定位已改为 locator.start/end。

更新日期：2026-10-17。状态：已实现，桌面交互需手动回归。

本说明在 [B 文件 v2](B文件格式-v2.md) 基础上增加业务属性。Source、locator、geometry、Entity 自身的分类和 SimpleNotes 的含义不变；不引入独立 Frame 对象。

## 1. 概念与命名

- Entity 的 `subject`、`kind`、`subKind` 仍描述 Entity 本身。
- “题干、答案、选项、条件”等是 Kind 的 **Role**，选项来自现有 Subject Schema 的 `rolesByKind`。
- A Object 的 `defaultRole` 表示加入 Entity 时的默认角色，包含 Subject/Kind 上下文。
- A Object 的 `comment` 是默认备注；与 Text 图形绘制的 `text` 内容不同。
- A Card 是 Entity 内对 A Object 的一次引用，其 `role`、`comment` 是独立属性副本。

## 2. 版本与顶层结构

```json
{
  "schemaVersion": 3,
  "sources": [],
  "annotations": [],
  "simpleNotes": [],
  "entities": [],
  "collections": []
}
```

| 输入版本 | 行为 |
| --- | --- |
| 无版本号 / 1 | 按旧 Frame 定位迁移，补充空默认属性，内存转换到 v3 |
| 2 | 保留 sourceId/locator，补充空默认属性，内存转换到 v3 |
| 3 | 校验并读取当前格式 |
| 其他版本 | 返回不支持版本错误，不覆盖文件 |

读取不会改写磁盘。用户保存时写入 v3。升级版本的原因是旧代码可能在 A Card 标准化时丢弃 comment，旧程序不应悄悄读写新文件。

## 3. A Object 新字段

```json
{
  "id": "a_001",
  "sourceId": "src_001",
  "locator": {"physicalPage": 12, "bookPageLabel": "8"},
  "type": "rect",
  "geometry": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3},
  "defaultRole": {"subject": "math", "kind": "question", "role": "stem"},
  "comment": "原始默认备注",
  "text": "",
  "style": {},
  "status": "active"
}
```

- defaultRole：`null` 或 `{subject, kind, role}`，各属性为字符串。
- 未设置默认角色时为 null。编辑时允许临时只选择 Subject/Kind、role 为空；加入 Entity 时视为尚未设置角色。
- 默认角色上下文不决定将来 Entity 的 Subject/Kind。
- comment：纯文本，默认空字符串，保留换行与空格。
- 旧数据缺少上述字段时补为 null/空字符串，不从任意 Entity 反推原始默认角色。

## 4. A Card 的独立副本

```json
{
  "id": "card_001",
  "aObjectId": "a_001",
  "role": "answer",
  "comment": "只在本 Entity 中使用的备注",
  "children": []
}
```

ACard 的 Subject/Kind 取自所属 Entity，不重复保存；原始 A.defaultRole 则保留自己的字典上下文。

现有 aCards、aObjectRefs、aObjectIds 保持兼容。createACardPatch 会把 role/comment 同步到 aObjectRefs；aObjectIds 仍仅保存 ID。

## 5. 初始化与独立性规则

1. A.defaultRole 的 subject、kind 必须与目标 Entity 一致，且 role 在目标 Kind 的选项中存在，才使用该默认角色。
2. 未设置或不兼容时，使用目标 Kind 的第一个角色（沿用原有默认规则）；没有选项时使用 default。
3. 添加对话框允许用户显式指定 Role，覆盖本次新引用的角色；默认选项为逐个采用原 A 默认角色并按规则回退。
4. comment 总是从原 A 复制；之后允许独立修改，包括清空。清空不会回退显示原 A 备注。
5. 修改 A 的默认属性不会更新已有 A Card。修改 A Card 不会修改原 A 或其他 Entity 中的引用。
6. “从原 A 对象重新复制属性”经确认后，重新计算 Role 并复制 Comment，覆盖当前节点这两个值。
7. Entity 变更 Subject/Kind 时，保留成员已有 Role/Comment。不适用的 Role 显示 invalid，供用户重新选择，不批量重置。
8. 修改按 Card ID 定位，同一 A 对象即使在树中被引用多次，也只改变选中的节点。

## 6. UI 容器与切换

两处复用 `AObjectProperties`。

### BWorkflow 底部

```text
aside.b-workflow-preview
  div.b-property-target-tabs        Entity 属性 / A Object 属性
  div.b-workflow-meta               现有 Entity 属性
  div.b-workflow-a-object-meta      当前 A Card 属性
```

两个属性容器同级，互斥显示。单选 A Card 自动切换到 A 属性；切换 Entity 清空局部 Card 选择并显示 Entity 属性。可手动切换，切换标签不改变选择；List/Preview 和缩放不随属性切换而重置。

A Card 属性中 Subject/Kind 只读，Role/Comment 可编辑；显示当前引用与原始默认值的区别，并提供重新复制按钮。无选择、多选、引用对象缺失时禁止编辑。

### 右侧 A Objects

```text
section.panel-section.a-objects-section
  div.section-title
  div.inspector-status-row
  div.object-list
  div.a-object-properties
```

列表与下方属性容器分别滚动。单选时编辑原始 A 默认 Subject/Kind/Role 和 Comment；多选或无选择仅显示提示。更换 Subject 清空 Kind/Role，更换 Kind 清空 Role。“清除默认角色”保留 Comment。

右键“编辑默认属性…”定位到右侧嵌入面板，不弹对话框。更改即时更新内存并标记 session 未保存，用户执行保存后才写盘。

CEditor 的 Entity List 只读显示 A Card 的 Role/Comment；纯图像 Preview 不叠加这些文字。裁剪图片不变，导出 manifest 附带对应引用的 Comment。

## 7. 统一入口与保持字段

- `src/shared/aObjectProperties.js`：字段标准化及默认角色匹配/回退。
- `src/renderer/domain/aObjectDefaults.js`：根据学科 schema 创建引用属性。
- `src/renderer/domain/aCardTree.js`：标准化、扁平化、复制、节点更新均保留 comment。
- `src/shared/annotationDocument.js`：v1/v2/v3 读取，保存输出 v3。
- `src/renderer/components/AObjectProperties.jsx`：共享编辑 UI。
- `App.jsx`、`BWorkflow.jsx`：右键、拖放、按钮、新建 Entity、添加到 Entity 接入同一初始化规则。

复制 Entity 递归生成新的 Card ID，保留层级、A 引用、Role/Comment。排序、移除、删除撤销沿用原树和快照，不能在这些操作时重新复制原 A 默认值。

## 8. 验证

```text
node --test --experimental-test-isolation=none src/shared/annotationDocument.test.js src/shared/annotationDocument.integration.test.js src/shared/mediaLocation.test.js src/shared/entityPreviewLocation.test.js src/shared/aObjectProperties.test.js
```

自动检查覆盖上下文匹配/不匹配、失效角色、显式角色覆盖、同 A 多 Entity 独立性、原始值后续变更、嵌套节点更新、空备注、排序/删除快照、递归复制、旧格式迁移和 v3 保存重开。

手动回归：编辑原 A 默认值 → 从四类入口加入 Entity → 编辑引用副本 → 切换属性页/Entity → 重新复制 → 保存重开 → CEditor 查看 List 及导出 manifest。另检查多选禁用、缩窄面板后的独立滚动、旧 v1/v2 视频/PDF/图片预览和 GO TO。

## 9. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-10-17 | 3 | 新增 A.defaultRole/comment、A Card.comment；双属性面板；保留无 Frame 定位 |
