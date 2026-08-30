# 高中数学主题 Schema 简化方案

## 基本分工

数学主题 schema 分为两类属性：

```text
Kind      = 大类
SubKind   = 子类
Role      = Entity 内部 A Card 的关联角色
Feature   = 查询 / 筛选 / 分类用的特征属性
```

注意：

```text
A Object 本体没有 Role。
Role 是 Entity 内部 A Card 引用节点上的关联属性。
```

## 成分属性

数学主题一级 `Kind` 简化为 3 个：

```text
question    题目
knowledge   知识
comment     评注
```

含义：

```text
question:
  面向一道题、一个例题、一个练习、一个错题、一个变式题。

knowledge:
  面向知识点、方法、模型、公式、结论、规则。

comment:
  面向老师或学生写下的解释、讲评、提醒、错因、反思、补充。
```

## question

`question` 表示题目类内容。

### SubKind

```text
example          例题
exercise         练习题
exam             真题 / 模拟题
variant          变式题
wrongQuestion    错题
openQuestion     探究题
```

### Role

```text
stem        题干
condition   条件
figure      图形
answer      答案
keyStep     关键步骤
remark      补充
```

## knowledge

`knowledge` 表示知识类内容。

### SubKind

```text
conceptDefinition   概念定义
theoremFormula      定理公式结论
method              方法技巧
modelRule           模型规则
summary             归纳总结
```

### Role

```text
default   默认
```

第一版不细分 `knowledge` 内部 Role。  
所有 A Card 都使用 `default`。

## comment

`comment` 表示讲评、笔记、反思、补充类内容。

### SubKind

```text
teacherComment   教师讲评
studentNote      学生笔记
mistakeReason    错因分析
reflection       反思
reminder         提醒
questionNote     疑问
blackboard       板书
supplement       补充材料
```

### Role

```text
default   默认
```

第一版不细分 `comment` 内部 Role。  
所有 A Card 都使用 `default`。

## 特征属性

特征属性用于查询、过滤、分类，不用于表示 Entity 的内部结构。

建议数学主题第一版特征属性分成这些组：

```text
source              来源
textbookSection     课本章节
knowledgePoint      知识点
secondaryConclusion 二级结论
methodTag           方法技巧标签
modelTag            模型图形标签
mistakeTag          易错易混淆
difficulty          难度
usage               教学用途
keyword             关键词
```

## source 来源

```text
textbook        教材
exerciseBook    教辅
exam            真题 / 模拟题
teacherHandout  教师讲义
studentNote     学生笔记
videoCourse     视频课程
other           其它
```

## textbookSection 课本章节

```text
sets                    集合
function                函数
trigonometry            三角函数
sequence                数列
inequality              不等式
derivative              导数
solidGeometry           立体几何
analyticGeometry        解析几何
conic                   圆锥曲线
probabilityStatistics   概率统计
```

## knowledgePoint 知识点

```text
conceptDefinition    概念定义
domainRange          定义域和值域
monotonicity         单调性
algebraicStructure   代数结构
polePolar            极点极线
homogeneousSymmetry  齐次对称
```

## secondaryConclusion 二级结论

```text
secondaryConclusion  二级结论
commonConclusion     常用结论
hiddenCondition      隐含条件
equivalentTransform  等价转化
```

## methodTag 方法技巧标签

```text
setWithoutSolving    设而不求
reverseThinking      正难则反
wholeSubstitution    整体代换
delayedSubstitution  延迟代换 / 延迟换元
elimination          消元
constructFunction    构造函数
scaling              放缩
classification       分类讨论
localGlobal          整体局部
sumProductSwitch     和积互换
```

## modelTag 模型图形标签

```text
motherChildProblem     母题子题
frameworkProblem       框架题
basicMethod            基本法
isomorphism            同构
fourPointsSixLines     四点六线三交叉点
conicTriangleIncenter  圆锥曲线与三角形内心
```

## mistakeTag 易错易混淆

```text
classicError       经典错误
ambiguous          混淆误解歧义
brokenThinking     思路间断点
wrongSubstitution  不恰当换元 / 消元
problemFlaw        题目瑕疵
confusableDetail   细节区别例外混淆对比辨析
```

## difficulty 难度

```text
basic       基础
medium      中档
advanced    拔高
final       压轴
errorProne  易错
```

## usage 教学用途

```text
classroom          课堂讲解
homework           作业
exam               测验
handout            专题讲义
questionBank       题库
wrongProblemBook   错题整理
review             复习
```

## keyword 关键词

```text
用户自定义关键词
```

## 设计收益

```text
1. Kind 很少，用户选择快。
2. Role 只在 question 中细分，避免过度设计。
3. source、二级结论、易错易混淆都放入 Feature，适合查询。
4. knowledge / comment 内部先统一 default，后续需要时再细分。
```

