import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  renderPlantUml,
  resolveJavaRuntime
} from "../../plugins/plantuml-renderer/scripts/server.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundledServerPath = path.join(
  repositoryRoot,
  "plugins",
  "plantuml-renderer",
  "dist",
  "server.mjs"
);
let testDirectory;

before(async () => {
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "plantuml-renderer-integration-"));
  process.env.PLUGIN_DATA = testDirectory;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("可以定位 Java 11 或更高版本", async () => {
  const runtime = await resolveJavaRuntime();
  assert.ok(runtime.command);
  assert.ok(runtime.majorVersion >= 11);
});

test("首次渲染会下载官方 JAR 并生成包含中文的 PNG", async () => {
  const result = await renderPlantUml({
    source: "@startuml\nAlice -> Bob: 你好\n@enduml",
    format: "png",
    name: "sequence"
  });

  assert.equal(result.runtimeCacheStatus, "downloaded");
  assert.equal(result.mimeType, "image/png");
  assert.ok(result.data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.ok(path.isAbsolute(result.path));
});

test("默认渲染 SVG 并命中内存缓存", async () => {
  const input = {
    source: "@startuml\nAlice -> Bob: 默认 SVG\n@enduml",
    name: "default-svg"
  };
  const rendered = await renderPlantUml(input);
  const cached = await renderPlantUml(input);

  assert.equal(rendered.format, "svg");
  assert.equal(rendered.mimeType, "image/svg+xml");
  assert.equal(rendered.runtimeCacheStatus, "hit");
  assert.equal(rendered.cacheStatus, "rendered");
  assert.equal(cached.cacheStatus, "memory");
});

test("并发的相同请求会复用同一次渲染", async () => {
  const input = {
    source: "@startuml\nAlice -> Bob: 并发去重\n@enduml",
    name: "concurrent-svg"
  };
  const results = await Promise.all([renderPlantUml(input), renderPlantUml(input)]);

  assert.equal(results[0].path, results[1].path);
  assert.deepEqual(
    new Set(results.map((result) => result.cacheStatus)),
    new Set(["rendered", "shared"])
  );
});

test("语法错误会返回诊断而不是错误图片", async () => {
  await assert.rejects(
    renderPlantUml({
      source: "@startuml\n!this_is_not_a_valid_preprocessor_directive\n@enduml",
      format: "png"
    }),
    /Error|Syntax|错误|退出码/i
  );
});

test("SANDBOX 会阻止读取本地 include", async () => {
  const secretPath = path.join(testDirectory, "secret.puml");
  await writeFile(secretPath, "Alice -> Bob: secret", "utf8");
  const includePath = secretPath.replaceAll("\\", "/");

  await assert.rejects(
    renderPlantUml({
      source: `@startuml\n!include ${includePath}\n@enduml`,
      format: "png",
      name: "blocked-include"
    }),
    /Error|Security|include|错误|退出码/i
  );
});

test("最终打包服务会重建损坏的磁盘缓存", async () => {
  const input = {
    source: "@startuml\nCache -> Renderer: recover\n@enduml",
    name: "corrupt-cache"
  };
  const initial = await renderPlantUml(input);
  await writeFile(initial.path, "corrupt", "utf8");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundledServerPath],
    env: { ...process.env, PLUGIN_DATA: testDirectory }
  });
  const client = new Client({ name: "plantuml-cache-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "render_plantuml",
      arguments: input
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /输出缓存：rendered/);
    assert.match(await readFile(initial.path, "utf8"), /<svg[\s>]/);
  } finally {
    await client.close();
  }
});

test("最终打包的 MCP 服务可以启动并渲染 SVG", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundledServerPath],
    env: { ...process.env, PLUGIN_DATA: testDirectory }
  });
  const client = new Client({ name: "plantuml-renderer-test", version: "1.0.0" });

  try {
    const startedAt = performance.now();
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "render_plantuml"));

    const source = "@startuml\nClient -> Server: MCP\n@enduml";
    const result = await client.callTool({
      name: "render_plantuml",
      arguments: { source, name: "mcp" }
    });
    const durationMs = performance.now() - startedAt;
    const textResult = result.content.find((item) => item.type === "text")?.text ?? "";
    assert.equal(result.isError, undefined);
    assert.match(textResult, /已生成 SVG/);
    assert.match(textResult, /PlantUML 运行时：hit/);
    assert.match(textResult, /<details>\n<summary>PlantUML 源码<\/summary>/);
    assert.ok(textResult.includes(`\`\`\`plantuml\n${source}\n\`\`\``));
    assert.ok(!result.content.some((item) => item.type === "image"));
    assert.ok(durationMs < 5000, `MCP 启动和渲染耗时 ${durationMs.toFixed(1)} ms，超过 5 秒`);
  } finally {
    await client.close();
  }
});
