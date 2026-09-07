import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  insertPlantUmlIntoMarkdown,
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
const fixturePath = path.join(repositoryRoot, "tests", "fixtures", "fsm-bake-blob.puml");
let testDirectory;

// PlantUML 的 SVG 把非 ASCII 文本写成数字实体，断言前先还原。
function decodeSvgText(svg) {
  return svg.replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

before(async () => {
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "plantuml-renderer-integration-"));
  process.env.PLANTUML_RENDERER_DATA = testDirectory;
  process.env.PLANTUML_WORKSPACE_ROOT = testDirectory;
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

test("outputPath 会把结果写到指定文件", async () => {
  const outputPath = path.join(testDirectory, "exported.svg");
  const result = await renderPlantUml({
    source: "@startuml\nAlice -> Bob: 导出\n@enduml",
    name: "exported",
    outputPath
  });

  assert.equal(result.path, outputPath);
  assert.match(await readFile(outputPath, "utf8"), /<svg[\s>]/);
  assert.notEqual(result.cachePath, outputPath);
});

test("outputPath 扩展名与格式不一致时报错", async () => {
  await assert.rejects(
    renderPlantUml({
      source: "@startuml\nAlice -> Bob: 扩展名\n@enduml",
      format: "svg",
      outputPath: path.join(testDirectory, "wrong.png")
    }),
    /扩展名必须是 \.svg/
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

test("真实设计图（中文 + legend + 颜色）可以渲染成 SVG", async () => {
  const source = await readFile(fixturePath, "utf8");
  const result = await renderPlantUml({ source, name: "fsm-bake-blob" });
  const svg = decodeSvgText(result.data.toString("utf8"));

  assert.equal(result.format, "svg");
  assert.ok(result.bytes > 20_000, `SVG 只有 ${result.bytes} 字节，可能没画出内容`);
  assert.ok(!svg.includes("Syntax Error"), "SVG 里出现了 PlantUML 语法错误图");
  assert.ok(svg.includes("FSMStateMachineBlob"), "SVG 里没有画出 FSMStateMachineBlob");
  assert.ok(svg.includes("最终 Graph"), "SVG 里没有渲染 legend 中的中文");
});

test("渲染结果可以写入 Markdown 并原地更新", async () => {
  const documentDirectory = path.join(testDirectory, "docs");
  await mkdir(documentDirectory, { recursive: true });
  const documentPath = path.join(documentDirectory, "设计.md");
  await writeFile(documentPath, "# 设计\n\n## 状态机结构\n\n说明文字\n", "utf8");
  const source = await readFile(fixturePath, "utf8");

  const inserted = await insertPlantUmlIntoMarkdown({
    markdownPath: documentPath,
    source,
    name: "FSM Bake 结构",
    assetDir: "assets",
    anchor: "## 状态机结构"
  });

  assert.equal(inserted.action, "inserted");
  assert.equal(inserted.embedId, "FSM-Bake-结构");
  assert.equal(inserted.imagePath, path.join(documentDirectory, "assets", "FSM-Bake-结构.svg"));
  assert.equal(inserted.sourcePath, path.join(documentDirectory, "assets", "FSM-Bake-结构.puml"));
  assert.match(await readFile(inserted.imagePath, "utf8"), /<svg[\s>]/);
  assert.match(await readFile(inserted.sourcePath, "utf8"), /@startuml[\s\S]*@enduml/);

  const afterInsert = await readFile(documentPath, "utf8");
  assert.match(afterInsert, /<!-- plantuml-begin: FSM-Bake-结构 -->/);
  assert.ok(afterInsert.indexOf("plantuml-begin") > afterInsert.indexOf("## 状态机结构"));
  assert.ok(afterInsert.includes("说明文字"));

  const updated = await insertPlantUmlIntoMarkdown({
    markdownPath: documentPath,
    source: "@startuml\nAlice -> Bob: 改过的图\n@enduml",
    name: "FSM Bake 结构",
    assetDir: "assets",
    caption: "第二版"
  });
  const afterUpdate = await readFile(documentPath, "utf8");

  assert.equal(updated.action, "replaced");
  assert.equal(afterUpdate.match(/plantuml-begin: FSM-Bake-结构/g).length, 1);
  assert.match(afterUpdate, /\*第二版\*/);
  assert.ok(decodeSvgText(await readFile(updated.imagePath, "utf8")).includes("改过的图"));
});

test("拒绝写入不存在的文档和目录外的资源路径", async () => {
  const documentPath = path.join(testDirectory, "docs", "设计.md");
  await assert.rejects(
    insertPlantUmlIntoMarkdown({
      markdownPath: path.join(testDirectory, "docs", "缺失.md"),
      source: "@startuml\nA -> B\n@enduml",
      name: "missing"
    }),
    /Markdown 文件不存在/
  );
  await assert.rejects(
    insertPlantUmlIntoMarkdown({
      markdownPath: documentPath,
      source: "@startuml\nA -> B\n@enduml",
      name: "escape",
      assetDir: "../outside"
    }),
    /必须位于 Markdown 文件所在目录内/
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
    env: { ...process.env, PLANTUML_RENDERER_DATA: testDirectory }
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

test("最终打包的 MCP 服务可以启动、渲染 SVG 并写入 Markdown", async () => {
  const documentPath = path.join(testDirectory, "docs", "mcp.md");
  await writeFile(documentPath, "# MCP\n", "utf8");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundledServerPath],
    env: { ...process.env, PLANTUML_RENDERER_DATA: testDirectory }
  });
  const client = new Client({ name: "plantuml-renderer-test", version: "1.0.0" });

  try {
    const startedAt = performance.now();
    await client.connect(transport);
    const listed = await client.listTools();
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["insert_plantuml_markdown", "render_plantuml"]
    );

    const source = "@startuml\nClient -> Server: MCP\n@enduml";
    const rendered = await client.callTool({
      name: "render_plantuml",
      arguments: { source, name: "mcp" }
    });
    const renderedText = rendered.content.find((item) => item.type === "text")?.text ?? "";
    assert.equal(rendered.isError, undefined);
    assert.match(renderedText, /已生成 SVG/);
    assert.match(renderedText, /PlantUML 运行时：hit/);
    assert.match(renderedText, /<details>\n<summary>PlantUML 源码<\/summary>/);
    assert.ok(renderedText.includes(`\`\`\`plantuml\n${source}\n\`\`\``));
    assert.ok(!rendered.content.some((item) => item.type === "image"));

    const embedded = await client.callTool({
      name: "insert_plantuml_markdown",
      arguments: { markdownPath: documentPath, source, name: "mcp-diagram" }
    });
    const embeddedText = embedded.content.find((item) => item.type === "text")?.text ?? "";
    assert.equal(embedded.isError, undefined);
    assert.match(embeddedText, /已写入 Markdown/);
    assert.match(embeddedText, /追加到文末/);
    assert.match(await readFile(documentPath, "utf8"), /!\[mcp-diagram\]\(\.\/mcp-diagram\.svg\)/);

    assert.ok(durationMs < 5000, `MCP 启动耗时 ${durationMs.toFixed(1)} ms，超过 5 秒`);
  } finally {
    await client.close();
  }
});
