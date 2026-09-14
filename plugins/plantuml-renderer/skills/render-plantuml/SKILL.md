---
name: render-plantuml
description: 涉及创建、预览、渲染或更新 PlantUML / UML 图（时序图、类图、状态图、组件图、活动图、思维导图、甘特图），需要把 .puml 导出成 SVG/PNG，或需要把图插入 Markdown 文档时，使用本地 plantuml-renderer MCP 工具渲染——不论这是用户明确要求的，还是在回答或撰写文档过程中主动判断需要配图。禁止手写 SVG、在回答或文档里直接贴 PlantUML 源码文本充当成品图，或调用在线渲染服务。
---

# PlantUML 渲染

本插件提供两个 MCP 工具，都在本机用 Java + PlantUML JAR 渲染，源码不会离开本机：

| 工具 | 用途 |
|------|------|
| `render_plantuml` | 渲染为 SVG/PNG，可选 `outputPath` 落盘到指定文件 |
| `insert_plantuml_markdown` | 渲染后把图片引用写进已存在的 Markdown 文档 |

## 工作流程

1. 根据输入生成完整、有效的 PlantUML 源码，保留与图类型匹配的 `@start...` / `@end...` 标记；输入本身是 `.puml` / `.txt` 文件路径时，先读该文件取源码。
2. 只是要看图、导出文件，或往回答里配一张图（不写入已存在的 Markdown 文档）时，调用 `render_plantuml`：
   - 未指定格式时用 `svg`；用户明确要位图、或需要在对话里直接看到图时用 `png`（PNG 会作为图片内容返回，SVG 只返回路径）。
   - 需要落盘到指定路径时传 `outputPath`：扩展名要与格式一致，父目录必须已存在。
3. 要把图放进一份已存在的 Markdown 文档（包括正在编写的方案/设计文档）时，调用 `insert_plantuml_markdown`，并传：
   - `markdownPath`：目标 Markdown 路径。文件不存在时停下来问用户，不要新建文档。
   - `name`：图表名称，同时作为标记块 ID 和 `<name>.svg` / `<name>.puml` 的文件名，可用中文。
   - `assetDir`：图片存放目录，相对文档目录，默认与文档同级；文档多图时建议传 `assets`。
   - `anchor`：首次插入位置，传目标标题行原文（如 `## 状态机结构`），图插到该行之后；不传则追加到文末。
   - `writeSource`：默认 `true`，会在图片旁写出同名 `.puml`，方便以后改图重渲。用户明确不要源码文件时传 `false`。
4. 工具报告语法错误时，按诊断修正源码后重试，最多两次；仍失败就如实报告原始诊断，不要把错误图或未渲染的源码描述成成功结果，也不要退回成直接贴源码文本。
5. 成功后回报：`render_plantuml` 场景回报输出文件的绝对路径并简述图里表达了什么；`insert_plantuml_markdown` 场景回报写入的文档路径、图片路径和插入方式（原地更新 / 锚点插入 / 追加到文末）。
6. 首次使用会下载并按 SHA-256 校验固定版本的 PlantUML JAR。下载失败时如实报告网络、校验或 Java 版本问题，不要绕过校验。

## 重复渲染与更新

`insert_plantuml_markdown` 写入的是标记块：

```markdown
<!-- plantuml-begin: 状态机结构 -->
![状态机结构](./状态机结构.svg)
<!-- plantuml-end: 状态机结构 -->
```

用同一个 `markdownPath` + `name` 再调用一次，就地替换块内内容并覆盖图片文件，不会产生重复图片。改图时优先复用原 `name`，不要换名字重插。

如果文档里已经有手写的 `![](xxx.svg)` 引用，先把它换成同名标记块（或直接把 `name` 设成该 SVG 的文件名，让工具覆盖同一个文件），避免文档里出现两份图。

## 约束

- 渲染器使用 `SANDBOX` 安全配置，`!include` 不能读本地文件或 URL；需要外部内容时，把必要定义直接写进源码。
- 中文图必须依赖工具内置的 `--charset UTF-8`，不要自己改写编码参数。
- 图片和 `.puml` 只能写在 Markdown 所在目录内，`assetDir` 不能用 `..` 跳出去。
- 不要为了渲染去修改用户已有的 `.puml` 文件，除非用户明确要求保存或更新源码。
