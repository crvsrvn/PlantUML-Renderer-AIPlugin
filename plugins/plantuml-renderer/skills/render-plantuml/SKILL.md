---
name: render-plantuml
description: 当用户要求创建、预览或渲染 PlantUML、UML、时序图、类图、状态图、组件图、活动图、思维导图或甘特图时，使用本地 PlantUML 工具生成 PNG 或 SVG。
---

# PlantUML 渲染

1. 根据用户输入生成完整、有效的 PlantUML 源码，保留适合图类型的 `@start...` 与 `@end...` 标记。
2. 调用 `plantuml-renderer` MCP 服务的 `render_plantuml` 工具。未指定格式时使用 `svg`；用户明确需要位图或客户端无法显示 SVG 时使用 `png`。
3. 工具成功后，优先用返回的绝对路径展示 SVG 或 PNG，并给出可打开的文件链接。SVG 结果还应保留工具返回的 `<details>` 折叠块，让用户按需展开完整 PlantUML 源码。
4. 工具报告语法错误时，根据诊断修正源码并重试；不要把错误图片或未经渲染的源码描述成成功结果。
5. 首次使用可能需要下载经过 SHA-256 校验的固定 PlantUML JAR。下载失败时，准确报告网络、校验或 Java 版本问题，不要绕过校验。
6. 渲染器使用 `SANDBOX` 安全配置，不支持从本地文件或 URL 执行 `!include`。用户需要外部内容时，先把必要定义显式写入源码。

不要为了渲染而修改用户现有的 `.puml` 文件，除非用户明确要求保存或更新源码。
