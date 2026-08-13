# PlantUML Renderer AIPlugin

A local PlantUML rendering plugin for Codex. It renders PNG or SVG through a stdio MCP server shipped with the plugin; diagram sources are never sent to a remote service.

## How It Works

1. The plugin checks for a Java runtime and requires Java 11 or later.
2. On first render, it downloads a pinned `plantuml.jar` from the official PlantUML GitHub Release.
3. The download must pass a pinned SHA-256 checksum and is then atomically written to the `PLUGIN_DATA` directory provided by Codex.
4. Subsequent renders reuse the already-verified local JAR; plugin updates and install caches do not affect runtime data.
5. PlantUML always runs with the `SANDBOX` security configuration, in headless mode, and with resource limits.

The first download accesses GitHub and may be affected by the Codex sandbox, network policy, or proxy configuration. Apart from that download request, rendering happens entirely on the local machine, and PlantUML sources never leave it.

## Prerequisites

- Codex desktop app or a plugin-capable Codex CLI
- Node.js 18 or later
- Java 11 or later
- Some diagram types may require Graphviz on Linux or macOS

You can specify the Java executable via `PLANTUML_JAVA`, or use the standard `JAVA_HOME` or `PATH`.

## Local Installation

```powershell
codex plugin marketplace add "E:\Repositories\PlantUML-Renderer-AIPlugin"
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

After installing, start a new Codex task and ask it to generate or render a PlantUML diagram.

## Sharing via Git

Once the repository is pushed to a Git service, recipients add the repository marketplace:

```text
codex plugin marketplace add OWNER/PlantUML-Renderer-AIPlugin --ref main
codex plugin add plantuml-renderer@plantuml-renderer-aiplugin
```

Replace `OWNER` with the actual GitHub organization or username. You can also pass an HTTPS or SSH Git URL to `marketplace add`.

## Development and Verification

```powershell
npm ci
npm run build
npm test
npm run test:integration
```

`npm run build` bundles the MCP server and its runtime dependencies into `plugins/plantuml-renderer/dist/server.mjs` and generates a summary of production dependency licenses. The build artifacts must be committed to Git, because the plugin installation does not rely on `npm install`.

Unit tests do not access the network. Integration tests use a real Java runtime and download the pinned PlantUML JAR from the official source to verify the final distribution path.

## Security Boundaries

- The download URL, version, and SHA-256 are pinned in `assets/plantuml-version.json`.
- Downloads use HTTPS, timeouts, a maximum size limit, temporary files, and atomic replacement.
- The `SANDBOX` configuration prevents `!include` from local files or URLs.
- Input, output, diagnostic sizes, and render time are all bounded.
- The plugin never silently installs Java or modifies system-level configuration.

## License

The plugin code is licensed under the MIT License. PlantUML is downloaded separately at runtime and is subject to its own license; see `THIRD_PARTY_NOTICES.md`.
