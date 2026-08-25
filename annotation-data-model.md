# Annotation Lab Data Model

## 1. ID Generation

Use UUID-style IDs, preferably through the built-in browser/Electron API:

```js
crypto.randomUUID()
```

Do not use timestamp-only IDs or simple auto-increment IDs. Objects in this project need to be persisted, referenced across layers, exported, imported, and possibly merged later.

Wrap ID creation with a small helper:

```js
export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`
}
```

Recommended prefixes:

```text
src_    Source object
frame_  alpha-layer frame reference
a_      A-layer geometry annotation
b_      B-layer domain entity
c_      C-layer collection or usage object
tag_    Tag object
```

## 2. Layer Overview

The project should separate persisted data into these main model types:

```text
Source       Original media or text source
FrameRef     Alpha-layer visual frame locator
AAnnotation  A-layer geometry annotation
BEntity      B-layer domain semantic object
CItem        C-layer usage, collection, or output object
```

The overall relationship is:

```text
Source 1 -> N FrameRef
FrameRef 1 -> N AAnnotation
AAnnotation N -> N BEntity
BEntity N -> N CItem
```

The C layer can trace back to the original media through:

```text
CItem
-> BEntity
-> AAnnotation
-> FrameRef
-> Source
-> alpha-layer adapter opens the correct file/page/time
```

## 3. Source

A `Source` represents an original input file: image, video, PDF, TXT, MD, etc.

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

Notes:

- `kind` can be `image`, `video`, `pdf`, `text`, or `markdown`.
- `fingerprint` is used to detect whether the source file may have changed.
- `meta` keeps source-specific properties.

## 4. FrameRef

A `FrameRef` is the alpha-layer representation of a visual frame that A layer can annotate.

Image:

```json
{
  "id": "frame_uuid",
  "sourceId": "src_uuid",
  "kind": "image",
  "locator": {}
}
```

Video:

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

PDF:

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

Notes:

- A layer only depends on `frameId`.
- A layer should not care whether the frame comes from an image, video, or PDF.
- Text-like files may skip A layer and go directly into B/C processing.

## 5. AAnnotation

An `AAnnotation` is a geometry object on a frame. It only describes visual position and shape.

Rectangle:

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

Point:

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

Text:

```json
{
  "id": "a_uuid",
  "frameId": "frame_uuid",
  "type": "text",
  "geometry": {
    "x": 0.3,
    "y": 0.4
  },
  "text": "Important",
  "status": "active"
}
```

Coordinate rule:

- Geometry is stored in normalized coordinates.
- `x`, `y`, `width`, and `height` are relative to the visible frame area.
- This keeps annotations stable across window resizing and zooming.

## 6. BEntity

A `BEntity` is a semantic domain object. It references one or more A-layer annotations.

Math example:

```json
{
  "id": "b_uuid",
  "theme": "math",
  "entityType": "question",
  "title": "Function monotonicity example",
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
  "tags": ["function", "monotonicity", "mistake-prone"],
  "note": "",
  "status": "incomplete",
  "validation": {
    "missingRoles": []
  },
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

English example:

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
  "tags": ["attributive-clause", "long-sentence"],
  "note": "",
  "status": "active"
}
```

Notes:

- B layer should not store geometry directly.
- B layer references A layer through `annotationIds`.
- Theme-specific rules should come from a schema, not from hard-coded UI logic.

## 7. CItem

A `CItem` represents C-layer usage: collection, lecture note draft, exercise set, sentence notebook, etc.

```json
{
  "id": "c_uuid",
  "type": "collection",
  "title": "Function mistake-prone questions",
  "entityIds": ["b_001", "b_008"],
  "tags": ["lecture", "review"],
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

Rules:

- C layer should usually reference B entities, not A annotations directly.
- Query results do not always need persistence.
- Collections, lecture drafts, exercise sets, and notebooks should be persisted.

## 8. Optional Relation Table

The first version should use embedded references:

```text
AAnnotation.frameId
BEntity.parts[].annotationIds
CItem.entityIds
```

A separate relation table is not needed at first.

If relationships become more complex later, add an explicit relation model:

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

Use this only when the relationship itself needs metadata such as weight, order, comment, or confidence.

## 9. Persistence File Structure

The lab project can start with one annotation JSON file per source file.

Image:

```text
abc.png.annotation.json
```

Video:

```text
abc.mp4.annotation.json
```

Suggested JSON structure:

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

Later, these JSON files can be indexed into SQLite for cross-file search and C-layer operations.

## 10. Design Boundaries

Important boundaries:

```text
Alpha layer: adapts image/video/PDF/text source differences.
A layer: binds only to frameId and stores geometry.
B layer: references annotationIds and applies domain schemas.
C layer: references entityIds and provides query/usage workflows.
```

The system must support incremental work:

```text
Create or edit A annotations.
Create or edit B semantic entities.
Use C-layer queries and collections.
Jump from C back to B, and from B back to A.
```

A/B/C work is not a waterfall process. Users will repeatedly switch between layers while gradually improving the data.
