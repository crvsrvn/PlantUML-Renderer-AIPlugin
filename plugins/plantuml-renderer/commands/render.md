---
description: 把 PlantUML 源码或 .puml 文件渲染成 SVG/PNG
argument-hint: [.puml 路径 | 图的描述] [--png] [--out <文件路径>]
---

把下面的输入渲染成图：

$ARGUMENTS

执行要求：

1. 输入是 `.puml` / `.txt` 文件路径时，先读该文件取源码；输入是自然语言描述时，先写出完整的 PlantUML 源码再渲染。
2. 调用 `render_plantuml`；默认 `format: "svg"`，出现 `--png` 时用 `png`。
3. 出现 `--out <文件路径>` 时把该路径传给 `outputPath`（扩展名要和格式一致，父目录必须已存在）。
4. 渲染失败时按工具返回的诊断修源码重试，最多两次；仍失败就如实报告原始诊断。
5. 成功后回报输出文件的绝对路径，并简述图里表达了什么。
