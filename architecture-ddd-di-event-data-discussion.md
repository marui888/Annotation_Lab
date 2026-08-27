# 工程架构、DDD、DI、事件驱动、数据密集型应用讨论归档

本文归档当前项目中关于软件工程架构、领域分析、数据模型、依赖注入、事件驱动和数据密集型应用设计的讨论。它不记录具体功能修改历史，而是保留对项目长期架构有指导意义的内容。

## 1. 软件项目数据模型

当前项目中出现了多类数据，它们都可以统称为“软件项目数据模型”，但在工程上需要分类和隔离。

主要类型包括：

- 用户持久化数据：例如 annotation.json、composite.json。
- 主题持久化数据：例如 subject schema，用于定义数学、英语等主题下的实体类型、角色、特征、规则。
- 工作流和交互状态数据：例如当前打开的 editor session、当前选中的 A Object、当前 Entity、当前 Composite item、dirty 状态、视图状态。
- 配置数据：例如快捷键、默认路径、主题 schema 文件路径、Preview 显示参数。
- 索引数据：例如从多个 annotation.json 中扫描出的 B Entity pool。
- 派生数据：例如搜索索引、预览缓存、引用修复扫描结果。

这些数据不应该混在一个层次里。比较稳妥的分类方式是：

```txt
Source of Truth
  用户真正保存和维护的数据
  annotation.json / composite.json / subject-schema.json

Configuration
  用户或开发者配置
  settings / shortcut / schema registry

Runtime State
  当前交互状态
  editor session / selection / active tab / dirty state

Derived Data
  可由 source of truth 重新生成
  index / preview cache / reference scan result
```

工程上的原则是：

- Source of Truth 要稳定、可演进、可迁移。
- Runtime State 可以丢失，除非明确需要恢复上次会话。
- Derived Data 不应该被当成唯一事实来源。
- 配置数据要和业务数据隔离。
- 主题语义模型不要硬编码进物理数据模型。

## 2. 物理模型与主题模型

项目中已有的 A/B/C 分层可以理解为物理成员模型：

```txt
A Object
  Konva 图形标记
  Rect / Arrow / Text

B Entity
  由一个或多个 A Object 组成
  是一个教学语义单元

Composite
  由 B Entity / Text / File / Composite 引用组成
  是讲义、题库、专题资料等复合文档
```

物理模型关心：

- 标记来自哪个文件。
- 标记位于哪一帧或哪一张图。
- 标记几何形状是什么。
- Entity 包含哪些 A Object。
- Composite 包含哪些 item。

主题模型关心：

- 当前 Entity 属于数学还是英语。
- Entity 是题目、讲解、翻译、语法点还是错题。
- A Object 在 Entity 中承担什么角色。
- Entity 具有哪些知识点、方法、错误类型、用途标签。
- Entity 是否满足主题规则。

因此，推荐结构是：

```txt
物理模型稳定
  AObject / Entity / Composite 的基本结构尽量不变

主题模型可配置
  Math / English / 后续其它主题通过 SubjectSchema 注入
```

Entity 不应该保存完整 schema，只保存 schema 选项的值：

```js
{
  id: 'entity-001',
  subject: 'math',
  kind: 'problem',
  aObjectTree: [],
  semantic: {
    roles: {
      'a-1': 'stem',
      'a-2': 'answer'
    },
    features: {
      knowledgePoints: ['圆锥曲线'],
      methods: ['设而不求'],
      keywords: ['同构换元']
    }
  }
}
```

这样以后 schema 的显示名称、校验规则、可选角色变化时，旧 Entity 数据仍然可以迁移或重新解释。

## 3. 主题特征如何依赖注入到 B 层

“主题特征作为依赖注入到 B 层语义标记逻辑中”的意思是：

```txt
B 层编辑器不直接认识数学/英语细节
B 层编辑器只依赖 SubjectSchema 接口
数学、英语是不同的 SubjectSchema 实现
```

核心接口可以是：

```js
const subjectSchema = {
  subject: 'math',
  label: '数学',
  kinds: [],
  rolesByKind: {},
  featureGroups: [],
  validationRules: [],
  validateEntity(entity) {
    return { ok: true, warnings: [], errors: [] }
  }
}
```

B 层编辑器使用方式：

```js
function BEntityEditor({ entity, subjectSchema, onChange }) {
  const kinds = subjectSchema.kinds
  const roles = subjectSchema.rolesByKind[entity.kind] || []
  const featureGroups = subjectSchema.featureGroups
  const validation = subjectSchema.validateEntity(entity)
}
```

这样做的效果是：

```txt
ABEditor / BWorkflow
  负责通用交互：选择 kind、设置 role、编辑 feature、显示 rule status

SubjectSchema
  负责主题定义：有哪些 kind、role、feature、validation rule
```

第一版可以用简单函数：

```js
const schema = getSubjectSchema(entity.subject)
```

以后如果要支持用户自定义 schema，可以升级为：

```jsx
<SubjectSchemaProvider schemas={subjectSchemas}>
  <ABEditor />
</SubjectSchemaProvider>
```

或者从文件系统加载：

```txt
schemas/
├─ math.subject-schema.json
├─ english.subject-schema.json
└─ custom.xxx.subject-schema.json
```

## 4. Subject Schema Editor

项目需要一个完整的 Subject Schema Editor，用于浏览、创建、修改 schema 自身。

它应该是独立编辑器，而不是塞进 ABEditor 或 CompositeEditor：

```txt
Subject Schema Editor
  编辑主题语义模型

ABEditor
  使用 schema 标注 Entity

CompositeEditor
  使用 Entity / Composite 组织材料
```

建议作为 workspace 顶部同级 Editor Tab：

```txt
[A/B] xxx.annotation.json
[C]   xxx.composite.json
[S]   Subject Schema Editor
```

第一版 schema 编辑工具支持：

```txt
Subject Schema
├─ 基本信息
│  ├─ subjectId
│  ├─ label
│  ├─ description
│  └─ version
│
├─ Entity Kinds
│  ├─ problem
│  ├─ solution
│  ├─ word
│  └─ grammar
│
├─ Roles By Kind
│  ├─ problem
│  │  ├─ stem required
│  │  ├─ answer optional
│  │  └─ analysis optional
│  └─ translation
│     ├─ original required
│     └─ translation optional
│
├─ Feature Groups
│  ├─ knowledgePoints
│  ├─ methods
│  ├─ mistakeTags
│  └─ usage
│
├─ Feature Values
│  ├─ 圆锥曲线
│  ├─ 设而不求
│  ├─ 非谓语
│  └─ 虚拟语气
│
└─ Validation Rules
   ├─ problem must have stem
   ├─ translation must have original
   └─ mistake should have mistakePoint
```

Schema 文件示例：

```json
{
  "schemaVersion": 1,
  "subject": "math",
  "label": "数学",
  "description": "初高中数学教学教研模型",
  "version": "1.0.0",
  "entityKinds": [
    {
      "value": "problem",
      "label": "题目",
      "description": "一个完整或部分数学题目"
    }
  ],
  "rolesByKind": {
    "problem": [
      {
        "value": "stem",
        "label": "题干",
        "required": true
      },
      {
        "value": "answer",
        "label": "答案",
        "required": false
      }
    ]
  },
  "featureGroups": [
    {
      "key": "knowledgePoints",
      "label": "知识点",
      "multi": true,
      "values": [
        { "value": "conic", "label": "圆锥曲线" },
        { "value": "derivative", "label": "导数" }
      ]
    }
  ],
  "validationRules": [
    {
      "id": "problem-required-stem",
      "kind": "problem",
      "level": "error",
      "type": "requiredRole",
      "role": "stem",
      "message": "题目必须包含题干"
    }
  ]
}
```

## 5. 数学主题模型

数学主题服务对象是初高中数学老师，目标是题库、讲义库、错题库、模型库、方法库。

数学 Entity 的主要 kind：

```txt
problem        题目
solution       解答 / 讲解
knowledge      知识点
method         技巧方法
model          模型 / 图形 / 母题结构
mistake        错题 / 易错点
summary        总结
example        例题
variant        变式题
```

数学 A Object 在 Entity 中的角色：

```txt
stem           题干
condition      条件
question       问法 / 目标
figure         图形
option         选项
answer         答案
solution       解答过程
analysis       思路分析
keyStep        关键步骤
knowledgePoint 知识点
method         方法技巧
model          模型总结
mistakePoint   易错点
confusion      混淆点
remark         补充说明
```

数学特征属性可以分组为：

```txt
课本章节
  集合、函数、导数、三角函数、数列、解析几何、立体几何、概率统计、不等式

知识点
  概念定义、二级结论、母题子题、典型错误、分类讨论、函数单调性、圆锥曲线、极点极线

技巧方法
  设而不求、正难则反、整体代换、换元、消元、构造函数、放缩、分类讨论、数形结合

模型图形
  母题、框架题、基本法、模型图形、同构、齐次对称、代数结构

错误特征
  经典典型错误、题目有瑕疵、表达不准确、混淆误解歧义、思路间断点、增根减根

教学用途
  课堂讲解、作业、测验、专题讲义、错题整理、复习资料
```

数学关系模型：

```js
[
  { type: 'variant-of', label: '变式题', targetEntityId: 'entity-xxx' },
  { type: 'uses-method', label: '使用方法', targetEntityId: 'entity-yyy' },
  { type: 'same-model-as', label: '同模型', targetEntityId: 'entity-zzz' },
  { type: 'confusable-with', label: '易混淆', targetEntityId: 'entity-aaa' }
]
```

数学校验规则示例：

```txt
problem 类型：
  必须包含 stem 或 question
  可选包含 figure、condition、answer、solution、analysis

solution 类型：
  必须包含 solution 或 analysis
  最好关联一个 problem

mistake 类型：
  必须包含 mistakePoint
  最好关联 problem 或 solution

model 类型：
  必须包含 model 或 summary
  可关联多个 problem
```

## 6. 英语主题模型

英语主题服务对象是初高中英语老师，目标是词汇、句型、语法、翻译、写作、阅读理解、易错点、讲义材料。

英语 Entity 的主要 kind：

```txt
word           单词
phrase         短语
sentence       句子
grammar        语法点
translation    翻译
writing        写作表达
reading        阅读材料
pronunciation  发音
mistake        错误 / 易错点
summary        总结
example        例句
pattern        句型句式
```

英语 A Object 在 Entity 中的角色：

```txt
original       原文
translation    译文
word           单词
phrase         短语
sentence       句子
definition     释义
example        例句
grammarPoint   语法点
analysis       分析
pronunciation  发音说明
usage          用法
contrast       对比
mistakePoint   易错点
remark         补充说明
```

英语特征属性可以分组为：

```txt
语法分类
  时态、语态、虚拟语气、非谓语、定语从句、名词性从句、状语从句、比较句、介词、副词、补语、主位述位

句型句式
  句型句式、长短句转化、简单并列复合句转化、拖后结构、无灵句、there be、as...as、疑问词强调句

翻译特征
  中英非一一对应、增译减译、被动翻译、含义转化、形合意合、主语转换、时间地点人物转化

语义特征
  双重性多重性、指代丢失、时间丢失、性别丢失、含义依赖上下文、逻辑关系依赖上下文、动作是否执行依赖上下文

错误特征
  时态搭配错误、英语使用不准确、不通顺不标准、歧义误解、观点错误或表达不当、与词典不同或没有

词汇特征
  单词短语、同源搭配、发音变音、多音字、介副词、介代连

教学用途
  词汇讲解、语法讲解、翻译训练、写作素材、阅读分析、课堂例句、错题整理
```

英语关系模型：

```js
[
  { type: 'explains', label: '解释', targetEntityId: 'entity-xxx' },
  { type: 'translation-of', label: '翻译对应', targetEntityId: 'entity-yyy' },
  { type: 'grammar-of', label: '语法分析', targetEntityId: 'entity-zzz' },
  { type: 'confusable-with', label: '易混淆', targetEntityId: 'entity-aaa' },
  { type: 'example-of', label: '例句', targetEntityId: 'entity-bbb' }
]
```

英语校验规则示例：

```txt
translation 类型：
  必须包含 original
  translation 可选

sentence 类型：
  必须包含 sentence 或 original
  可选 grammarPoint、translation、analysis

word 类型：
  必须包含 word
  可选 definition、example、usage、pronunciation

grammar 类型：
  必须包含 grammarPoint 或 analysis
  最好关联 sentence/example

pattern 类型：
  必须包含 original 或 sentence
  可选 translation、analysis、example
```

## 7. DDD、领域分析、信息架构、UI 工作流建模

项目中的核心问题不只是“怎么画框、怎么保存 JSON”，而是：

```txt
老师在什么场景下使用这些数据
哪些东西是稳定领域概念
哪些只是交互临时状态
哪些内容需要检索、复用、组合
哪些数据应该被引用而不是复制
```

DDD 适合回答：

```txt
A Object、Entity、Composite 是不是领域概念
它们的边界在哪里
谁是聚合根
哪些操作应该属于领域服务
哪些只是 UI 操作
Subject Schema 是领域配置还是应用配置
```

信息架构适合回答：

```txt
关键词如何组织
特征如何分类
老师如何从大量 Entity 中找到目标
题库、讲义库、专题库如何导航
搜索、筛选、标签之间如何配合
```

UI 工作流建模适合回答：

```txt
老师如何从画面生成 A Object
如何把 A Object 组合成 Entity
如何从很多 Entity 组合 Composite
如何预览、筛选、修改、保存
如何减少模式切换和认知负担
```

推荐资料：

```txt
Domain-Driven Design - Eric Evans
Domain-Driven Design Reference - Eric Evans
Implementing Domain-Driven Design - Vaughn Vernon
Information Architecture: For the Web and Beyond - Rosenfeld / Morville / Arango
User Story Mapping - Jeff Patton
About Face - Alan Cooper 等
Patterns of Enterprise Application Architecture - Martin Fowler
```

## 8. MVC、MVP、MVVM、IoC、AOP、事件驱动

这些属于局部架构模式和工程组织方式，和 DDD/信息架构互补。

在当前项目中的对应关系：

```txt
MVC / MVP / MVVM
  ABEditor / CompositeEditor 的 UI 分层
  View 负责显示
  Controller / ViewModel 处理用户意图
  Domain Service 处理模型变化

IoC / DI
  Subject Schema 注入
  Source Adapter 注入
  Preview Renderer 注入
  Validation Rules 注入

AOP
  dirty tracking
  undo/redo
  shortcut handling
  logging/debug info
  validation
  save-before-close

Event-driven
  file opened
  annotation changed
  entity selected
  composite item added
  index rebuilt
  reference repaired
```

推荐资料：

```txt
Martin Fowler - GUI Architectures
Dependency Injection: Principles, Practices, and Patterns - Mark Seemann / Steven van Deursen
Patterns of Enterprise Application Architecture - Martin Fowler
Enterprise Integration Patterns - Gregor Hohpe / Bobby Woolf
Designing Event-Driven Systems - Ben Stopford
React 官方文档：Thinking in React
```

对项目最实用的架构组合：

```txt
DDD / 信息架构
  解决“模型是什么”

PoEAA / GUI Architectures
  解决“UI、服务、数据如何分层”

Dependency Injection
  解决“主题 schema、adapter、renderer 如何注入”

Enterprise Integration Patterns
  解决“事件、后台任务、索引、引用修复如何组织”
```

## 9. Designing Data-Intensive Applications 的相关性

《Designing Data-Intensive Applications》不是领域建模书，而是数据系统架构书。

它主要关心：

```txt
数据怎么存
怎么索引
怎么查询
怎么保持一致性
怎么演进 schema
怎么处理派生数据
怎么做批处理、流处理、数据流设计
```

和当前项目的关系：

```txt
annotation.json / composite.json / subject-schema.json 的演进
SQLite 索引如何设计
哪些数据是 source of truth
哪些数据是 derived data
引用关系如何避免断裂
批量扫描、引用修复、索引重建如何组织
本地文件和数据库状态如何保持一致
```

对当前项目最相关的章节方向：

```txt
Data Models and Query Languages
  帮助分析 A/B/C、Entity、Composite、Subject Schema 的数据表达

Storage and Retrieval
  帮助设计 SQLite 索引、关键词查询、Entity 检索

Encoding and Evolution
  帮助设计 JSON schemaVersion、迁移、兼容旧数据

Transactions
  帮助分析多文件保存、半保存、引用修复的一致性问题

Dataflow
  帮助组织扫描目录、建立索引、生成派生视图
```

一句话总结：

```txt
DDIA 不能直接教你“数学题库/英语讲义”的主题模型怎么设计，
但它能帮助避免把这些数据做成以后无法查询、无法演进、无法维护的一团硬 JSON。
```

## 10. Infrastructure as Code 的相关性

《Infrastructure as Code》主要讲：

```txt
把服务器、网络、数据库、权限、部署环境等基础设施
用代码和自动化流程定义、创建、修改、测试和管理
```

它更适合云服务、环境管理、自动部署、CI/CD、服务器配置等场景。

和当前项目的直接关系不强，但有一个思想相关：

```txt
配置即代码
```

对应到当前项目：

```txt
Subject Schema 可以看成领域配置代码化
快捷键配置可以看成交互配置代码化
项目设置可以看成应用配置代码化
打包脚本可以看成发布流程代码化
```

它的优先级低于 DDD、信息架构、GUI 架构、依赖注入、数据模型演进等资料。等项目进入自动打包、自动发布、后端同步或云端部署阶段，再认真阅读更合适。

## 11. 当前项目的建议方向

下一步比较合理的架构推进顺序：

```txt
1. 明确 Source of Truth
   annotation.json / composite.json / subject-schema.json

2. 抽离 Subject Schema
   从硬编码 domainSchemas 变成可加载配置

3. 实现 Subject Schema Editor
   浏览、创建、修改、保存 schema

4. ABEditor 使用 schema 动态生成 UI
   kind / role / feature / validation

5. CompositeEditor 使用 schema 辅助筛选和组织
   按 subject / kind / feature / keyword 过滤 B Entity

6. 建立索引层
   扫描 annotation/composite/schema 文件，生成可查询索引

7. 设计迁移机制
   schemaVersion / dataVersion / migration
```

核心原则：

```txt
物理数据模型稳定
主题语义模型可配置
工作流状态和持久化数据隔离
索引和缓存可重建
编辑器只依赖抽象接口，不依赖具体主题细节
```
