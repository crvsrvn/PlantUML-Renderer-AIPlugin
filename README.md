# PlantUML Renderer AIPlugin

面向 Codex 的本地 PlantUML 渲染插件。它通过随插件分发的 stdio MCP 服务生成 PNG 或 SVG；图表源码不会发送到远程服务。

## 运行机制

1. 插件检查 Java 运行时，要求 Java 11 或更高版本。
2. 首次渲染时，从 PlantUML 官方 GitHub Release 下载固定版本的 `plantuml.jar`。
3. 下载内容必须通过固定 SHA-256 校验，随后原子写入 Codex 提供的 `PLUGIN_DATA` 目录。
4. 后续渲染直接复用已校验的本地 JAR；插件更新和安装缓存不会破坏运行时数据。
5. PlantUML 始终以 `SANDBOX` 安全配置、无界面模式和资源限制运行。

首次下载会访问 GitHub，可能受 Codex 沙箱、网络策略或代理配置影响。除该下载请求外，渲染过程完全在本机完成，PlantUML 源码不会出站。

## 前置条件

- Codex 桌面应用或支持插件的 Codex CLI
- Node.js 18 或更高版本
- Java 11 或更高版本
- 部分图类型在 Linux 或 macOS 上可能需要 Graphviz

可通过 `PLANTUML_JAVA` 指定 Java 可执行文件，也可以使用标准 `JAVA_HOME` 或 `PATH`。

## 本地安装

```powershell
codex plugin marketplace add "E:\Repositories\PlantUML-Renderer-AIPlugin"
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

安装后新建 Codex 任务，再要求生成或渲染 PlantUML 图。

## 通过 Git 分享

将本仓库推送到 Git 服务后，接收者添加仓库 marketplace：

```text
codex plugin marketplace add OWNER/PlantUML-Renderer-AIPlugin --ref main
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

`OWNER` 替换为实际 GitHub 组织或用户名。也可以向 `marketplace add` 传入 HTTPS 或 SSH Git URL。

## 开发与验证

```powershell
npm ci
npm run build
npm test
npm run test:integration
```

`npm run build` 将 MCP 服务及运行依赖打包为 `plugins/plantuml-renderer/dist/server.mjs`，并生成生产依赖许可证汇总。构建产物需要提交到 Git，因为插件安装时不会依赖 `npm install`。

单元测试不访问公网。集成测试会使用真实 Java，并从官方地址下载固定 PlantUML JAR，以验证最终分发路径。

## 安全边界

- 下载 URL、版本与 SHA-256 固定在 `assets/plantuml-version.json`。
- 下载采用 HTTPS、超时、最大体积限制、临时文件和原子替换。
- `SANDBOX` 配置禁止从本地文件或 URL 执行 `!include`。
- 输入、输出、诊断大小和渲染时间均有限制。
- 插件不会静默安装 Java 或修改系统级配置。

## 许可证

插件代码采用 MIT 许可证。PlantUML 在运行时单独下载并适用其自身许可证，详见 `THIRD_PARTY_NOTICES.md`。
