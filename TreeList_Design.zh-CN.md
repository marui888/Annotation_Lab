# TreeList 设计文档

## 1. 设计目的

当前 lab 项目中，一个 Entity 内部有两种视图：

- A Card List：编辑视图，用于调整 Entity 内部的 A Card。
- B Preview：预览视图，用于审阅同一批 A Card 的最终效果。

现在这两个视图本质上都是同一份有序列表的两种显示方式。下一步要把这个模型升级为：

```text
Entity = A Card Tree
```

也就是说，Entity 不再只是“由 A Card 组成的有序列表”，而是“由 A Card 组成的有序树”。

设计目标是：

```text
树形结构的显示、选择、拖动、层级调整等通用交互只实现一次。
A Card List 和 B Preview 只提供不同的节点显示方式。
```

所以需要一个通用的 `TreeList` React 控件，并通过外部传入的 `renderNode` 渲染业务节点。

## 2. 核心概念

### A Object

A Object 是画布上的 A 层标记：

```text
Rect
Arrow
Text
```

它存放在 `annotations` 中。

### A Card

A Card 是 Entity 内部的节点，它引用一个 A Object，并携带 Entity 层面的业务含义：

```js
{
  id: 'card-xxx',
  aObjectId: 'a-xxx',
  role: 'stem',
  children: []
}
```

A Card 不是 A Object 本身。

它是一个引用节点，额外包含：

```text
role
顺序
层级
children
```

### A Card Tree

新的 Entity 真实模型是：

```js
{
  id: 'b-xxx',
  subject: 'math',
  kind: 'question',
  label: '题目1',
  aCards: [
    {
      id: 'card-1',
      aObjectId: 'a-1',
      role: 'stem',
      children: [
        {
          id: 'card-2',
          aObjectId: 'a-2',
          role: 'answer',
          children: []
        }
      ]
    }
  ]
}
```

### 旧数据

旧数据使用的是平铺有序列表：

```js
{
  aObjectRefs: [
    { aObjectId: 'a-1', role: 'stem' },
    { aObjectId: 'a-2', role: 'answer' }
  ],
  aObjectIds: ['a-1', 'a-2']
}
```

加载旧数据时，需要把 `aObjectRefs` 转成一级 A Card Tree：

```js
[
  { id: 'card-1', aObjectId: 'a-1', role: 'stem', children: [] },
  { id: 'card-2', aObjectId: 'a-2', role: 'answer', children: [] }
]
```

保存时应保存新的 `aCards` 树结构。

过渡期仍然可以保存派生出来的兼容字段：

```js
{
  aCards: [...],
  aObjectRefs: flattenACardTree(aCards),
  aObjectIds: flattenACardTree(aCards).map(card => card.aObjectId)
}
```

约定：

```text
aCards 是主数据。
aObjectRefs / aObjectIds 是兼容字段。
```

## 3. 架构关系

正确的关系不是：

```text
TreeList
├─ 通用树交互
└─ 业务节点渲染器
```

因为业务节点渲染器不应该是 TreeList 的内部组成部分。

更准确的关系是：

```text
业务层
├─ 准备 tree data
├─ 准备 selectedIds
├─ 准备 onTreeChange / onSelect
└─ 提供 renderNode

          通过 props 注入
                |
                v

通用 TreeList 控件
├─ 递归显示树
├─ 处理缩进
├─ 处理选择
├─ 处理拖动排序
├─ 触发 onTreeChange
└─ 在每个节点位置调用 renderNode(node, context)
```

依赖方向是：

```text
业务层依赖 TreeList。
TreeList 不依赖业务层。
TreeList 只调用外部传入的 renderNode。
```

这样才符合组件化和依赖反转。

## 4. 推荐文件结构

```text
src/
└─ renderer/
   ├─ components/
   │  └─ tree-list/
   │     ├─ TreeList.jsx
   │     ├─ TreeList.css
   │     └─ treeOperations.js
   │
   ├─ domain/
   │  └─ aCardTree.js
   │
   ├─ workflow/
   │  ├─ BWorkflow.jsx
   │  ├─ BWorkflow.css
   │  ├─ ACardTreeNode.jsx
   │  └─ BPreviewTreeNode.jsx
   │
   └─ ab-editor/
      ├─ APreviewCard.jsx
      ├─ ABEditor.jsx
      └─ ...
```

## 5. 通用 TreeList 层

### `components/tree-list/TreeList.jsx`

`TreeList` 是通用 React 控件。

它只认识最基本的树节点结构：

```js
{
  id: 'node-id',
  children: []
}
```

它不认识：

```text
A Object
A Card
Entity
role
subject
annotation
preview
export
```

职责：

```text
1. 递归渲染树节点。
2. 根据 depth 显示缩进。
3. 维护拖动时的 drop target 状态。
4. 显示 selected 状态。
5. 支持单选 / Ctrl 多选。
6. 支持 before / after / inside 拖放。
7. 触发 onTreeChange(nextTree)。
8. 在每个节点位置调用 renderNode(node, context)。
9. 支持 readOnly 模式。
```

使用示例：

```jsx
<TreeList
  tree={tree}
  selectedIds={selectedIds}
  readOnly={false}
  onSelect={setSelectedIds}
  onTreeChange={handleTreeChange}
  renderNode={(node, context) => (
    <NodeView node={node} context={context} />
  )}
/>
```

`context` 可以包含：

```js
{
  depth,
  selected,
  readOnly,
  dragging,
  dropPosition,
  toggleSelect
}
```

### `components/tree-list/treeOperations.js`

这是纯函数工具文件。

建议包含：

```js
findNode(tree, nodeId)
removeNode(tree, nodeId)
insertNodeBefore(tree, targetId, node)
insertNodeAfter(tree, targetId, node)
insertNodeInside(tree, targetId, node)
moveNode(tree, sourceId, targetId, position)
flattenTree(tree)
mapTree(tree, mapper)
normalizeTree(tree)
```

drop 位置：

```text
before
after
inside
```

第一版可以用简单鼠标区域判断：

```text
上方区域 -> before
中间区域 -> inside
下方区域 -> after
```

以后再优化成更接近 Foxit PDF Reader 书签栏的交互。

### `components/tree-list/TreeList.css`

只放通用树样式：

```text
节点缩进
hover
selected
drop line
drop inside highlight
readOnly 状态
```

不要放 A/B/C 业务样式。

## 6. 领域层：`domain/aCardTree.js`

`aCardTree.js` 不是 UI 适配器，而是 Entity 内部 A Card Tree 的领域操作库。

它有两个职责：

```text
1. 旧有序列表数据迁移为新有序树模型。
2. 提供 A Card Tree 的领域操作函数。
```

### `createACardNode(ref)`

创建一个新的 A Card 节点：

```js
createACardNode({
  aObjectId: 'a-1',
  role: 'stem'
})
```

返回：

```js
{
  id: 'card-xxx',
  aObjectId: 'a-1',
  role: 'stem',
  children: []
}
```

### `refsToACardTree(aObjectRefs)`

把旧的平铺有序列表转为一级树：

```js
refsToACardTree([
  { aObjectId: 'a-1', role: 'stem' },
  { aObjectId: 'a-2', role: 'answer' }
])
```

返回：

```js
[
  { id, aObjectId: 'a-1', role: 'stem', children: [] },
  { id, aObjectId: 'a-2', role: 'answer', children: [] }
]
```

### `normalizeACardTree(tree)`

清洗树结构，保证每个节点都有：

```text
id
aObjectId
role
children
```

### `getEntityACardTree(entity)`

读取 Entity 的 A Card Tree 的统一入口：

```js
const tree = getEntityACardTree(entity)
```

规则：

```text
如果 entity.aCards 存在：
  normalize 后返回。
否则：
  把 entity.aObjectRefs 转成一级树。
```

### `flattenACardTree(tree)`

按深度优先顺序展开树：

```js
flattenACardTree([
  {
    aObjectId: 'a-1',
    role: 'stem',
    children: [
      { aObjectId: 'a-2', role: 'answer', children: [] }
    ]
  }
])
```

返回：

```js
[
  { id, aObjectId: 'a-1', role: 'stem', path: [0] },
  { id, aObjectId: 'a-2', role: 'answer', path: [0, 0] }
]
```

用途：

```text
Preview 显示顺序
导出顺序
兼容字段生成
校验
Entity 列表摘要
```

### `createACardPatch(tree)`

由树结构生成 Entity 更新 patch：

```js
const patch = createACardPatch(nextTree)
```

返回：

```js
{
  aCards: normalizedTree,
  aObjectRefs: [
    { aObjectId, role },
    ...
  ],
  aObjectIds: [
    aObjectId,
    ...
  ]
}
```

这样每次 TreeList 改变树后，都能保持兼容字段同步：

```js
onUpdateEntity(selectedEntity.id, createACardPatch(nextTree))
```

## 7. BWorkflow 业务层

### `workflow/BWorkflow.jsx`

`BWorkflow` 负责把这些东西组合起来：

```text
selectedEntity
annotations
TreeList
业务节点渲染器
domain/aCardTree.js
```

以后不要再直接使用：

```js
const entityRefs = getEntityAObjectRefs(selectedEntity)
```

而是：

```js
const entityTree = selectedEntity
  ? getEntityACardTree(selectedEntity)
  : []

const flatCards = flattenACardTree(entityTree)
```

树改变时：

```js
onUpdateEntity(selectedEntity.id, createACardPatch(nextTree))
```

### A Card List 视图

```jsx
<TreeList
  tree={entityTree}
  selectedIds={selectedCardIds}
  onSelect={setSelectedCardIds}
  onTreeChange={(nextTree) => {
    onUpdateEntity(selectedEntity.id, createACardPatch(nextTree))
  }}
  renderNode={(node, context) => (
    <ACardTreeNode
      node={node}
      annotation={getAnnotationById(node.aObjectId)}
      subjectSchema={subjectSchema}
      onRoleChange={handleRoleChange}
      onRemove={handleRemove}
      context={context}
    />
  )}
/>
```

### B Preview 视图

```jsx
<TreeList
  tree={entityTree}
  readOnly
  renderNode={(node, context) => (
    <BPreviewTreeNode
      node={node}
      annotation={getAnnotationById(node.aObjectId)}
      imageUrl={imageUrl}
      imageSize={imageSize}
      context={context}
    />
  )}
/>
```

两者使用同一份 `entityTree`，区别只是 `renderNode` 不同。

## 8. 业务节点渲染器

### `workflow/ACardTreeNode.jsx`

用于编辑视图。

职责：

```text
显示 role 下拉框。
显示 A Object 类型。
显示 geometry/text 简要信息。
显示 remove 等操作。
根据 context.selected 显示选中效果。
```

树节点移动不应该写在这里，应该由 `TreeList` 负责。

### `workflow/BPreviewTreeNode.jsx`

用于预览视图。

职责：

```text
显示 APreviewCard。
显示 role。
显示 A Object 裁切预览。
只读。
```

它不修改树数据。

## 9. 树结构下的导出规则

Entity 导出应该使用深度优先展开后的 A Card Tree：

```js
const cards = flattenACardTree(getEntityACardTree(entity))

const tasks = cards.map((card, index) => {
  const annotation = annotations.find(item => item.id === card.aObjectId)
  return createAnnotationExportTask(annotation, imageSize, {
    index,
    role: card.role,
    path: card.path
  })
})
```

未来可以在文件名中体现层级：

```text
001_role_rect_a-xxx.png
001-001_role_text_a-yyy.txt
001-002_role_arrow_a-zzz.png
002_role_rect_a-zzz.png
```

第一版也可以继续使用简单序号。

## 10. 校验规则

现有校验逻辑如果依赖平铺 refs，以后应改为：

```js
const refs = flattenACardTree(getEntityACardTree(entity))
```

然后继续做已有校验：

```text
required role 是否存在
optional role 是否存在
缺失 role 警告
```

以后可以增加树层级校验：

```text
题干下面可以有答案。
译文下面可以有原文。
某些 role 不允许作为某些 role 的子节点。
```

第一版不建议加入复杂层级规则。

## 11. 迁移实施步骤

### 第一步

新增：

```text
components/tree-list/*
domain/aCardTree.js
```

暂时不改 UI。

### 第二步

把 BWorkflow 的 List Tab 改成：

```text
TreeList + ACardTreeNode
```

旧数据通过：

```js
getEntityACardTree(entity)
```

自动转换。

### 第三步

把 B Preview Tab 改成：

```text
TreeList readOnly + BPreviewTreeNode
```

### 第四步

把保存、导出、校验路径改成使用：

```js
getEntityACardTree()
flattenACardTree()
createACardPatch()
```

### 第五步

实现拖动层级调整：

```text
before
after
inside
```

### 第六步

未来 C 层复用：

```text
CItemTreeNode.jsx
domain/cItemTree.js
```

继续复用同一个 `TreeList`。

## 12. 未来 C 层复用

C Document item 以后也可能成为树：

```js
{
  id,
  type: 'b-ref' | 'text' | 'file-ref' | 'c-ref',
  children: []
}
```

届时 C 层可以这样使用：

```jsx
<TreeList
  tree={cItemTree}
  renderNode={(node, context) => (
    <CItemTreeNode node={node} context={context} />
  )}
/>
```

这个复用能成立，是因为 `TreeList` 只依赖：

```js
node.id
node.children
```

其它内容都由业务层的 `renderNode` 决定。

## 13. 总结

最终设计是：

```text
TreeList = 通用树 UI 和树交互控件。
renderNode = 外部注入的业务节点渲染策略。
aCardTree.js = Entity 内部 A Card Tree 的领域操作库。
BWorkflow = 组合 Entity 数据、TreeList 和业务渲染器。
```

新 Entity 内容的主数据是：

```js
entity.aCards
```

兼容字段是派生数据：

```js
entity.aObjectRefs
entity.aObjectIds
```

A Card List 和 B Preview 应该使用同一棵 A Card Tree：

```text
同一份数据，不同渲染方式。
```

