# PlantUML Renderer

同时支持 Claude Code 与 Codex 的本地 PlantUML 渲染插件。通过插件自带的 stdio MCP 服务，在本机把 PlantUML 源码渲染成 SVG 或 PNG，可选直接写进 Markdown 文档。图的源码不会发给任何远程服务。

两个平台共用同一套渲染内核（`plugins/plantuml-renderer/scripts/`），只有插件清单、MCP 启动方式按平台各自维护一份，参见[目录结构](#目录结构)。

## 工作原理

1. 插件检查 Java 运行时，要求 Java 11 或更高版本。
2. 首次渲染时，从 PlantUML 官方 GitHub Release 下载固定版本的 `plantuml.jar`。
3. 下载必须通过固定 SHA-256 校验，然后原子写入数据目录：Codex 会提供 `PLUGIN_DATA`；Claude Code 不提供，插件回退到用户级目录（默认 `~/.claude/plantuml-renderer`），这样插件更新或重装不会清掉运行时。
4. 之后的渲染直接复用已校验的本地 JAR。
5. PlantUML 始终以 `SANDBOX` 安全配置、headless 模式和资源上限运行。

除首次下载会访问 GitHub 外，渲染完全在本机完成。

## 前置条件

- Claude Code（桌面版、CLI 或 IDE 扩展）或 Codex（桌面版 / 支持插件的 CLI）
- Node.js 18 或更高版本
- Java 11 或更高版本
- Linux / macOS 上部分图类型需要 Graphviz

可以用 `PLANTUML_JAVA` 指定 Java 可执行文件，也可以走标准的 `JAVA_HOME` 或 `PATH`。

## 安装

### Claude Code

```bash
claude plugin marketplace add E:\Repositories\PlantUML-Renderer-AIPlugin
claude plugin install plantuml-renderer@plantuml-renderer-claude
```

安装后用 `/mcp` 或 `claude mcp list` 确认 `plantuml-renderer` 已连接，再开始新的对话。桌面版对应的是 `/plugin marketplace add` / `/plugin install` 斜杠命令。

### Codex

```powershell
codex plugin marketplace add "E:\Repositories\PlantUML-Renderer-AIPlugin"
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

安装后开始新的 Codex 任务，直接要求它生成或渲染 PlantUML 图即可。

### 通过 Git 分享

仓库推到 Git 服务后，接收方直接添加仓库市场：

```bash
# Claude Code
claude plugin marketplace add OWNER/PlantUML-Renderer-AIPlugin
claude plugin install plantuml-renderer@plantuml-renderer-claude

# Codex
codex plugin marketplace add OWNER/PlantUML-Renderer-AIPlugin --ref main
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

把 `OWNER` 换成实际的 GitHub 组织或用户名，也可以传 HTTPS / SSH 地址。`dist/server.mjs` 和 `licenses/` 是构建产物但必须提交到仓库，因为安装过程不会执行 `npm install`。

## 目录结构

```
.claude-plugin/marketplace.json          Claude Code 市场清单
.agents/plugins/marketplace.json         Codex 市场清单
plugins/plantuml-renderer/
  scripts/                               共享渲染内核（两个平台同一份代码）
  skills/render-plantuml/                共享 Skill
  .claude-plugin/plugin.json             Claude Code 插件清单
  .codex-plugin/plugin.json              Codex 插件清单
  .mcp.claude-code.json                  Claude Code 的 MCP 启动配置
  .mcp.codex.json                        Codex 的 MCP 启动配置
  dist/server.mjs                        构建产物，两个平台共用
```

两份 MCP 配置的差异只是启动方式：Claude Code 用 `${CLAUDE_PLUGIN_ROOT}` 模板变量给出绝对路径；Codex 用相对路径加显式 `cwd`。两个平台都只暴露 Skill，没有独立的斜杠命令。

## 插件提供的能力

| 类型 | 名称 | 说明 | 平台 |
|------|------|------|------|
| MCP 工具 | `render_plantuml` | 渲染 SVG/PNG，可选 `outputPath` 落盘到指定文件 | 两者 |
| MCP 工具 | `insert_plantuml_markdown` | 渲染后把图片引用写进已存在的 Markdown | 两者 |
| Skill | `render-plantuml` | 让 AI 在涉及 UML / PlantUML 的场景里自动走本地渲染，不论是用户明确要求还是 AI 自己判断需要配图 | 两者 |

不需要记命令，直接说“把这段 PlantUML 渲染成 SVG”“把这张状态机图插到 `设计.md` 的《状态机结构》一节下面”即可。

## 写入 Markdown 的约定

`insert_plantuml_markdown` 写入的是带标记的块：

```markdown
<!-- plantuml-begin: 状态机结构 -->
![状态机结构](./状态机结构.svg)
<!-- plantuml-end: 状态机结构 -->
```

- 图片写在 `<Markdown 目录>/<assetDir>/<name>.<格式>`，`assetDir` 默认与文档同级，且只能在文档目录内。
- `writeSource` 默认为 `true`，会在图片旁写出同名 `.puml`，方便以后改图重渲。
- 用同样的 `markdownPath` + `name` 再调用一次，标记块就地更新、图片覆盖，不会出现重复图。
- 目标 Markdown 必须已经存在：插件只改文档，不新建文档。
- 首次插入可以用 `anchor` 指定位置（传目标标题行原文），不传则追加到文末。
- 文档原有的 CRLF 换行和 BOM 会被保留。

## 环境变量

| 变量 | 作用 |
|------|------|
| `PLANTUML_JAVA` | 指定 Java 可执行文件路径 |
| `PLANTUML_RENDERER_DATA` | 覆盖 JAR 与渲染缓存目录，优先级高于 `PLUGIN_DATA` |
| `PLUGIN_DATA` | Codex 自动提供的数据目录；Claude Code 不提供 |
| `PLANTUML_WORKSPACE_ROOT` | 相对路径参数的解析基准，默认是 MCP 服务的工作目录 |
| `PLANTUML_PLUGIN_ROOT` | 插件根目录；`.mcp.claude-code.json` 从 `${CLAUDE_PLUGIN_ROOT}` 注入，Codex 侧不需要设置 |

## 开发与验证

```bash
npm ci
npm run verify
```

`npm run verify` 等价于 `npm run build && npm test && npm run test:integration`。`npm run build` 用 esbuild 把 MCP 服务和运行时依赖打包成 `plugins/plantuml-renderer/dist/server.mjs`，并生成生产依赖许可证汇总。

单元测试不访问网络。集成测试会用真实 Java 运行时，从官方来源下载固定 JAR，覆盖渲染、缓存、SANDBOX 拦截、Markdown 写入与重渲，以及打包后 MCP 服务的启动路径。

## 安全边界

- 下载地址、版本与 SHA-256 固定在 `assets/plantuml-version.json`。
- 下载使用 HTTPS、超时、大小上限、临时文件与原子替换。
- `SANDBOX` 配置禁止 `!include` 读取本地文件或 URL。
- 输入、输出、诊断大小与渲染时间都有上限。
- 写文件受限：输出扩展名必须与格式一致，Markdown 必须已存在，资源目录不能跳出文档目录。
- 插件不会静默安装 Java，也不会修改系统级配置。

## 许可证

插件代码使用 MIT 许可证。PlantUML 在运行时单独下载，遵循其自身许可证，详见 `THIRD_PARTY_NOTICES.md`。
