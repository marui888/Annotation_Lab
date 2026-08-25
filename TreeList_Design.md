# TreeList Design

## 1. Purpose

The lab project now has two views over the same Entity content:

- A Card List: editing view for Entity internal A Cards.
- B Preview: review view for the same A Cards.

At the moment both views are flat lists. The next model is:

```text
Entity = A Card Tree
```

An Entity is no longer only an ordered list of A Cards. It is an ordered tree of A Cards. Each tree node is an A Card, and each A Card references one A Object on the canvas.

The design goal is to avoid implementing tree behavior twice. A generic `TreeList` component should provide tree display and interaction, while business renderers decide what each node looks like.

## 2. Key Concepts

### A Object

An A Object is a canvas annotation:

```text
Rect
Arrow
Text
```

It belongs to the A layer and is stored in `annotations`.

### A Card

An A Card is an Entity-internal node that references an A Object:

```js
{
  id: 'card-xxx',
  aObjectId: 'a-xxx',
  role: 'stem',
  children: []
}
```

An A Card is not the A Object itself. It is a reference node with extra Entity meaning:

- role
- order
- hierarchy
- children

### A Card Tree

The new true Entity model is:

```js
{
  id: 'b-xxx',
  subject: 'math',
  kind: 'question',
  label: 'Question 1',
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

### Legacy Data

Old data uses a flat ordered list:

```js
{
  aObjectRefs: [
    { aObjectId: 'a-1', role: 'stem' },
    { aObjectId: 'a-2', role: 'answer' }
  ],
  aObjectIds: ['a-1', 'a-2']
}
```

When old data is loaded, `aObjectRefs` should be converted to a first-level A Card Tree:

```js
[
  { id: 'card-1', aObjectId: 'a-1', role: 'stem', children: [] },
  { id: 'card-2', aObjectId: 'a-2', role: 'answer', children: [] }
]
```

After saving, the Entity should be saved with `aCards`. During the transition period, derived compatibility fields should also be saved:

```js
{
  aCards: [...],
  aObjectRefs: flattenACardTree(aCards),
  aObjectIds: flattenACardTree(aCards).map(card => card.aObjectId)
}
```

`aCards` is the source of truth. `aObjectRefs` and `aObjectIds` are compatibility fields.

## 3. Architecture

The relationship should be:

```text
Business Layer
├─ prepares tree data
├─ prepares selected ids
├─ provides onTreeChange / onSelect
└─ provides renderNode

          props
            |
            v

Generic TreeList
├─ renders recursive tree
├─ handles indentation
├─ handles selection
├─ handles drag/drop
├─ emits onTreeChange
└─ calls renderNode(node, context)
```

The business renderer is not an internal module of `TreeList`. It is injected into `TreeList` as a render prop.

Dependency direction:

```text
Business layer depends on TreeList.
TreeList does not depend on business layer.
TreeList only calls renderNode supplied by the business layer.
```

This keeps the generic tree component reusable for B layer and future C layer work.

## 4. Proposed File Structure

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

## 5. Generic TreeList Layer

### `components/tree-list/TreeList.jsx`

`TreeList` is a generic React component. It only knows this node shape:

```js
{
  id: 'node-id',
  children: []
}
```

It does not know:

- A Object
- A Card
- Entity
- role
- subject
- annotation
- preview
- export

Responsibilities:

```text
1. Render recursive tree nodes.
2. Apply depth indentation.
3. Maintain visual drop target state.
4. Support selected node display.
5. Support single select and Ctrl multi-select.
6. Support drag/drop before / after / inside.
7. Emit onTreeChange(nextTree).
8. Call renderNode(node, context) at each node.
9. Support readOnly mode.
```

Example API:

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

`context` should include:

```js
{
  depth,
  selected,
  readOnly,
  dragging,
  dropPosition,
  toggleSelect,
}
```

### `components/tree-list/treeOperations.js`

Pure tree manipulation functions:

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

Drop positions:

```text
before
after
inside
```

First implementation can use simple mouse zones:

```text
top area    -> before
middle area -> inside
bottom area -> after
```

Later it can be refined to behave more like Foxit PDF Reader bookmarks.

### `components/tree-list/TreeList.css`

Only generic tree styles:

```text
node indentation
hover
selected
drop line
drop inside highlight
readOnly state
```

No business-specific colors or labels should be placed here unless they are generic.

## 6. Domain Layer: `domain/aCardTree.js`

`aCardTree.js` is not primarily a UI adapter. It is the domain operation library for Entity A Card Tree.

It has two jobs:

```text
1. Convert legacy ordered list data to the new ordered tree model.
2. Provide operations for the A Card Tree domain model.
```

Suggested functions:

### `createACardNode(ref)`

Create a new A Card node:

```js
createACardNode({
  aObjectId: 'a-1',
  role: 'stem'
})
```

Returns:

```js
{
  id: 'card-xxx',
  aObjectId: 'a-1',
  role: 'stem',
  children: []
}
```

### `refsToACardTree(aObjectRefs)`

Convert old flat list data to first-level tree:

```js
refsToACardTree([
  { aObjectId: 'a-1', role: 'stem' },
  { aObjectId: 'a-2', role: 'answer' }
])
```

Returns:

```js
[
  { id, aObjectId: 'a-1', role: 'stem', children: [] },
  { id, aObjectId: 'a-2', role: 'answer', children: [] }
]
```

### `normalizeACardTree(tree)`

Clean and normalize tree nodes:

```text
Ensure each node has:
id
aObjectId
role
children
```

### `getEntityACardTree(entity)`

Main read entry:

```js
const tree = getEntityACardTree(entity)
```

Rules:

```text
If entity.aCards exists:
  normalize and return it.
Else:
  convert entity.aObjectRefs to a first-level tree.
```

### `flattenACardTree(tree)`

Depth-first flatten:

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

Returns:

```js
[
  { id, aObjectId: 'a-1', role: 'stem', path: [0] },
  { id, aObjectId: 'a-2', role: 'answer', path: [0, 0] }
]
```

Used by:

```text
Preview order
Export order
Compatibility fields
Validation
Entity list summary
```

### `createACardPatch(tree)`

Create an Entity patch from tree:

```js
const patch = createACardPatch(nextTree)
```

Returns:

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

This allows all writes to keep old compatibility fields in sync.

## 7. Workflow Layer

### `workflow/BWorkflow.jsx`

`BWorkflow` combines:

```text
selectedEntity
annotations
TreeList
business node renderers
domain/aCardTree.js
```

Instead of:

```js
const entityRefs = getEntityAObjectRefs(selectedEntity)
```

Use:

```js
const entityTree = selectedEntity
  ? getEntityACardTree(selectedEntity)
  : []

const flatCards = flattenACardTree(entityTree)
```

When the tree changes:

```js
onUpdateEntity(selectedEntity.id, createACardPatch(nextTree))
```

### A Card List View

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

### B Preview View

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

Both views use the same `entityTree`. They differ only in `renderNode`.

## 8. Business Node Renderers

### `workflow/ACardTreeNode.jsx`

Node renderer for editing.

Responsibilities:

```text
Show role selector.
Show A Object type.
Show short geometry/text summary.
Show remove button.
Possibly show small drag handle.
Use context.selected for selected style.
```

It does not manage tree movement itself. Tree movement belongs to `TreeList`.

### `workflow/BPreviewTreeNode.jsx`

Node renderer for review.

Responsibilities:

```text
Show APreviewCard.
Show role.
Show A Object preview.
Read-only.
```

It does not mutate tree data.

## 9. Export Rules With Tree

Entity export should use depth-first flattened A Card Tree:

```js
const cards = flattenACardTree(getEntityACardTree(entity))

const tasks = cards.map((card, index) => {
  const annotation = annotations.find(item => item.id === card.aObjectId)
  return createAnnotationExportTask(annotation, imageSize, {
    index,
    role: card.role,
    path: card.path,
  })
})
```

Possible future filename format with hierarchy:

```text
001_role_rect_a-xxx.png
001-001_role_text_a-yyy.txt
001-002_role_arrow_a-zzz.png
002_role_rect_a-zzz.png
```

Current simple index can remain at first. The tree path can be added later.

## 10. Validation Rules

Existing validation currently reads flat refs. It should eventually read flattened A Card Tree:

```js
const refs = flattenACardTree(getEntityACardTree(entity))
```

Then existing role checks can continue:

```text
required role exists
optional role exists
missing role warning
```

Tree hierarchy itself can later introduce more rules:

```text
Stem can have answer children.
Translation can have original children.
Certain roles cannot be nested under certain roles.
```

First implementation should not add these advanced hierarchy rules.

## 11. Migration Strategy

### Step 1

Add:

```text
components/tree-list/*
domain/aCardTree.js
```

Do not change UI yet.

### Step 2

Change BWorkflow List Tab to use:

```text
TreeList + ACardTreeNode
```

Old data is converted by:

```js
getEntityACardTree(entity)
```

### Step 3

Change B Preview Tab to use:

```text
TreeList readOnly + BPreviewTreeNode
```

### Step 4

Change save/export/validation paths to use:

```js
getEntityACardTree()
flattenACardTree()
createACardPatch()
```

### Step 5

Add drag/drop hierarchy editing:

```text
before
after
inside
```

### Step 6

Future C layer reuse:

```text
CItemTreeNode.jsx
domain/cItemTree.js
```

Use the same `TreeList`.

## 12. Future C Layer Reuse

C Document items may later become a tree:

```js
{
  id,
  type: 'b-ref' | 'text' | 'file-ref' | 'c-ref',
  children: []
}
```

Then C layer can use:

```jsx
<TreeList
  tree={cItemTree}
  renderNode={(node, context) => (
    <CItemTreeNode node={node} context={context} />
  )}
/>
```

This reuse works because `TreeList` only depends on:

```js
node.id
node.children
```

Everything else is business-specific and rendered by `renderNode`.

## 13. Summary

The final design is:

```text
TreeList = generic tree UI and interaction component.
renderNode = business rendering strategy injected from outside.
aCardTree.js = Entity A Card Tree domain operation library.
BWorkflow = combines Entity data, TreeList, and business renderers.
```

The source of truth for new Entity content is:

```js
entity.aCards
```

Legacy fields are transitional and derived:

```js
entity.aObjectRefs
entity.aObjectIds
```

Both A Card List and B Preview should use the same A Card Tree:

```text
Same data, different renderer.
```

