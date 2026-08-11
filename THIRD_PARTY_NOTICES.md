# 第三方软件声明

本仓库的 MIT 许可证只适用于本项目自行编写的代码，不改变第三方组件的许可证。

## PlantUML

- 项目：https://github.com/plantuml/plantuml
- 固定版本：`1.2026.6`
- 许可证：GPL；可在 PlantUML JAR 中执行 `java -jar plantuml.jar -license` 查看
- 官方发布文件：https://github.com/plantuml/plantuml/releases/tag/v1.2026.6

本仓库不分发 `plantuml.jar`。插件首次使用时从版本元数据记录的官方 GitHub Release 地址下载，并在执行前校验固定 SHA-256。PlantUML 源码、二进制及其许可证由 PlantUML 项目提供。

## Node.js 依赖

- `@modelcontextprotocol/sdk`：MIT
- `zod`：MIT
- `esbuild`：MIT，仅用于开发期构建

具体版本及传递依赖记录在 `package-lock.json`。随插件分发的全部生产依赖许可证正文由构建脚本生成到 `plugins/plantuml-renderer/licenses/THIRD_PARTY_LICENSES.txt`；`esbuild` 不进入插件运行产物。
