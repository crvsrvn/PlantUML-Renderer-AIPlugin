---
description: 渲染 PlantUML 并把图片写进指定的 Markdown 文档
argument-hint: <markdown 路径> <.puml 路径 | 图的描述> [--name <图表名>] [--anchor <标题行>] [--assets <子目录>]
---

把图渲染出来并写进 Markdown：

$ARGUMENTS

执行要求：

1. 第一个参数是目标 Markdown 路径，必须已存在；不存在就停下来问用户，不要新建文档。
2. 剩余输入是 `.puml` 路径时读文件取源码，是描述时先写出完整 PlantUML 源码。
3. 调用 `insert_plantuml_markdown`：
   - `name` 取 `--name`，没给就用 `.puml` 文件名或图的主题（可用中文）。
   - `--anchor` 给了就传 `anchor`（首次插入到该标题行之后），没给则追加到文末。
   - `--assets` 给了就传 `assetDir`，没给用默认值 `.`（与文档同级）。
4. 目标文档里已有同名标记块时工具会原地更新，这是预期行为，不要改名重插。
5. 渲染失败时按诊断修源码重试，最多两次；成功后回报写入的文档路径、图片路径和插入方式（原地更新 / 锚点插入 / 追加到文末）。
