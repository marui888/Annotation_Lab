# Lab B 文件格式 v3.1：视频定位与时间区间

更新日期：2026-10-17。当前写入版本：数字 `3.1`（不是字符串）。

本版本在 [v3](B文件格式-v3.md) 的基础上，将视频 A Object 的 `locator.time` 改为 `locator.start/end`。A 默认属性、Entity 引用属性、几何数据和文件名约定保持不变；不恢复独立的 Frame 数据。

## 1. 文件结构与视频 A Object

文件名为完整来源文件名加 `.annotation.json`，例如 `lesson.mp4.annotation.json`。

```json
{
  "schemaVersion": 3.1,
  "sources": [
    {
      "id": "src_001",
      "kind": "video",
      "filePath": "C:/notes/lesson.mp4",
      "fileName": "lesson.mp4",
      "meta": {"width": 1920, "height": 1080, "duration": 300}
    }
  ],
  "annotations": [
    {
      "id": "a_001",
      "sourceId": "src_001",
      "locator": {"start": 125.4, "end": 127.95},
      "type": "rect",
      "geometry": {"x": 0, "y": 0, "width": 1, "height": 1},
      "defaultRole": null,
      "comment": "这一段的笔记"
    }
  ],
  "entities": [],
  "simpleNotes": [],
  "collections": []
}
```

- start/end 单位为秒，必须是有限数字且 `0 <= start <= end`。允许零长度区间。
- start 是唯一的画面定位依据。GO TO、画面上对象的匹配、截图、预览、裁剪和导出都只用 start。
- end 是区间终点，供区间播放及与 Better 互通使用。本轮不增加 Lab 区间编辑或区间播放界面。
- 不重复保存 `time`、`timeStamp`、`frameId` 或 `frames`。
- end 缺失时默认 `start + 2.55`；明确提供的无效 end 必须报错，不用默认值掩盖。
- 已有合法 end 在普通加载、编辑和保存中原样保留，不因为视频时长或默认长度重新计算。
- 新建/默认区间的 end 在已知视频时长内截断。若旧的时长元数据小于 start，保留 start，默认 end 取 start，避免反向区间；不伪造或回退画面时间。
- SimpleNotes 自己的 start/end 独立于 A Object，不作迁移或绑定。

## 2. 图片和 PDF 不变

```json
{"locator": {}}
```

图片不使用时间定位。PDF 继续按物理页定位，保留书籍页标签：

```json
{"locator": {"physicalPage": 12, "bookPageLabel": "8"}}
```

不要给图片或 PDF 强行补 start/end。

## 3. 读旧写新

| 输入版本 | 视频迁移 |
| --- | --- |
| 无版本 / 1 | 优先使用旧 Frame.locator.time，其次 Frame.timeStamp，再按原兼容顺序读取 A.timeStamp / locator，生成 start/end |
| 2 / 3 | locator.time 转为 start，缺失 end 时生成默认区间 |
| 3.1 | 必须提供数字 start；不能用 time 代替缺失或非法 start；保留合法 end，缺失时补默认值 |
| 其它版本或字符串版本号 | 拒绝加载/写入，返回不支持版本错误 |

所有受支持版本保存为 3.1。旧文件打开时只在内存迁移，不立即写盘；用户保存后才更新文件。迁移不修改输入对象，不生成独立 F 对象，不改变 A ID、Entity 引用、Comment、默认属性及 SimpleNotes。

旧版 Lab 只认识 1/2/3，不能打开 3.1，需要更新应用，不应手工降低版本号绕过校验。

## 4. 视频画面与重新绑定

新建 A Object 从当前暂停画面取得 start，并建立默认区间。当前视频画面定位也在内存使用 start/end。

用户通过原有视频时间绑定功能将已有 A Object 从旧 start 移到新 start 时：

1. 保留原区间长度 `end - start`，整体平移至新的 start。
2. 新 end 超出已知视频末尾时截断，但不小于新 start。
3. 绑定到相同 start 时精确保留原 end。
4. 只有缺少合法旧区间时，才使用默认 2.55 秒。

本功能依旧是定位绑定，不把 end 用于选择另一个帧图片。

## 5. 缓存、预览、导出

- A 画面缓存键：来源文件名/指纹、媒体种类与 start。end 不参与缓存键。
- 同来源、同 start、不同 end 的对象共享同一截图任务和缓存结果。
- 截图和播放器 API 参数仍叫 `time`，它是从 start 提取的单个时间值，不是新的存储字段。
- `getVideoStart` 只读兼容旧 `locator.time`，方便旧快照或调用方；有 start 时绝不让旧 time 覆盖它。
- CEditor 的 Composite 文件仍为自身原有 schemaVersion 1。本次 3.1 仅指 B 文件，不改变 C 文件 schema。
- CEditor Entity 预览及 Export 通过公共定位函数读取 start，不使用 end 截另一张图。

## 6. Better 后续接入约定（本轮不修改 Better）

- 旧 Start → locator.start；旧 End → locator.end；旧 Content → A.comment。
- 旧记录迁移为普通全画面 Rect，标准化坐标为 x/y=0、width/height=1，不增加 AUTO 图形类型。
- 区间不再需要放在 Better 专用扩展字段中。
- Better 新建文件的 entities 可以为空，但打开 Lab 文件后保存时必须保留原 Entity 等非编辑范围数据。
- Better 的旧格式转换、区间编辑、冲突保护及往返验证属于后续任务，不在本次 Lab 修改中实现。

## 7. 代码入口和验证

- `src/shared/videoLocator.js`：默认区间、校验、只读时间兼容与重新绑定。
- `src/shared/annotationDocument.js`：版本边界、旧版本迁移和统一保存。
- `src/shared/mediaLocation.js`：帧目标、缓存键和画面匹配。
- `src/App.jsx`：创建、绑定、GO TO、列表标签和两个保存入口。
- `src/renderer/ab-editor/ABEditor.jsx`：当前视频画面、初始跳转和绘图定位。
- `src/renderer/c-editor/entityPreviewResources.js` / `compositeExport.js`：通过公共定位函数使用 start。

数据测试命令（不启动应用、不 build）：

```powershell
node --test --experimental-test-isolation=none src/shared/annotationDocument.test.js src/shared/annotationDocument.integration.test.js src/shared/mediaLocation.test.js src/shared/entityPreviewLocation.test.js src/shared/aObjectProperties.test.js src/shared/videoLocator.test.js
```

人工回归：分别打开旧视频/图片/PDF 笔记；视频创建四种图形并保存重开；GO TO 和重新绑定后核对画面；从 CEditor 的 Source、Selected Detail、Composite Preview 预览视频 Entity；验证 ABEditor 和 CEditor 导出；检查两处保存入口均写入 3.1 并保留 Entity。
