import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ensurePlantUmlJar, readPlantUmlMetadata } from "./plantuml-runtime.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECURITY_PROFILE = "SANDBOX";
const MINIMUM_JAVA_VERSION = 11;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const JAVA_CHECK_TIMEOUT_MS = 5_000;
const MAX_MEMORY_CACHE_ENTRIES = 8;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const memoryOutputCache = new Map();
const activeRenders = new Map();

let javaRuntimePromise;
let plantUmlMetadataPromise;

export class RenderError extends Error {}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findAdoptiumJava(root) {
  if (!root || !(await fileExists(root))) {
    return undefined;
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const runtimeDirectories = entries
    .filter((entry) => entry.isDirectory() && /^(jre|jdk)-/i.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

  for (const entry of runtimeDirectories) {
    const candidate = path.join(root, entry.name, "bin", "java.exe");
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function discoverJavaCommand() {
  if (process.env.PLANTUML_JAVA?.trim()) {
    return process.env.PLANTUML_JAVA.trim();
  }

  if (process.env.JAVA_HOME?.trim()) {
    const executable = process.platform === "win32" ? "java.exe" : "java";
    const candidate = path.join(process.env.JAVA_HOME.trim(), "bin", executable);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32") {
    const roots = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Eclipse Adoptium"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Eclipse Adoptium")
    ];
    for (const root of roots) {
      const candidate = await findAdoptiumJava(root);
      if (candidate) {
        return candidate;
      }
    }
  }

  return "java";
}

export function parseJavaMajorVersion(output) {
  const quoted = output.match(/version\s+"([^"]+)"/i)?.[1];
  const unquoted = output.match(/\b(?:openjdk|java)\s+(\d+(?:[._]\d+)*)/i)?.[1];
  const rawVersion = quoted ?? unquoted;
  if (!rawVersion) {
    return undefined;
  }
  const parts = rawVersion.split(/[._-]/);
  const major = Number(parts[0] === "1" ? parts[1] : parts[0]);
  return Number.isInteger(major) && major > 0 ? major : undefined;
}

function inspectJavaRuntime(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let timeoutFailure;
    const timeout = setTimeout(() => {
      timeoutFailure = new RenderError(
        `Java 版本检查超过 ${JAVA_CHECK_TIMEOUT_MS / 1000} 秒，已终止。`
      );
      child.kill();
    }, JAVA_CHECK_TIMEOUT_MS);

    const collect = (chunk) => {
      if (bytes >= MAX_STDERR_BYTES) {
        return;
      }
      const accepted = chunk.subarray(0, MAX_STDERR_BYTES - bytes);
      bytes += accepted.length;
      chunks.push(accepted);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      const detail = error.code === "ENOENT" ? "未找到 Java 运行时" : error.message;
      reject(new RenderError(`${detail}。请安装 Java ${MINIMUM_JAVA_VERSION} 或更高版本。`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutFailure) {
        reject(timeoutFailure);
        return;
      }
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (exitCode !== 0) {
        reject(new RenderError(`Java 版本检查失败：${output || `退出码 ${exitCode}`}。`));
        return;
      }
      const majorVersion = parseJavaMajorVersion(output);
      if (!majorVersion) {
        reject(new RenderError(`无法识别 Java 版本：${output || "没有输出"}。`));
        return;
      }
      if (majorVersion < MINIMUM_JAVA_VERSION) {
        reject(
          new RenderError(
            `Java ${majorVersion} 版本过低；PlantUML 需要 Java ${MINIMUM_JAVA_VERSION} 或更高版本。`
          )
        );
        return;
      }
      resolve({ command, majorVersion, output });
    });
  });
}

export async function resolveJavaRuntime() {
  javaRuntimePromise ??= (async () => inspectJavaRuntime(await discoverJavaCommand()))();
  try {
    return await javaRuntimePromise;
  } catch (error) {
    javaRuntimePromise = undefined;
    throw error;
  }
}

export async function resolveJavaCommand() {
  return (await resolveJavaRuntime()).command;
}

async function resolvePlantUmlMetadata() {
  plantUmlMetadataPromise ??= readPlantUmlMetadata(PLUGIN_ROOT);
  try {
    return await plantUmlMetadataPromise;
  } catch (error) {
    plantUmlMetadataPromise = undefined;
    throw error;
  }
}

function resolveDataRoot() {
  return path.resolve(
    process.env.PLUGIN_DATA?.trim() || path.join(os.tmpdir(), "plantuml-renderer")
  );
}

function normalizeSource(source) {
  if (typeof source !== "string") {
    throw new RenderError("PlantUML 源码必须是字符串。");
  }
  const normalized = source.replaceAll("\r\n", "\n").trim();
  if (!normalized) {
    throw new RenderError("PlantUML 源码不能为空。");
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_SOURCE_BYTES) {
    throw new RenderError(`PlantUML 源码不能超过 ${MAX_SOURCE_BYTES / 1024} KiB。`);
  }
  return `${normalized}\n`;
}

function sanitizeName(name) {
  const sanitized = (name ?? "diagram")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "diagram";
}

function markdownPath(filePath) {
  return encodeURI(filePath.replaceAll("\\", "/"))
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F");
}

function collapsiblePlantUmlSource(source) {
  let longestBacktickRun = 0;
  for (const match of source.matchAll(/`+/g)) {
    longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
  }
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [
    "<details>",
    "<summary>PlantUML 源码</summary>",
    "",
    `${fence}plantuml`,
    source,
    fence,
    "",
    "</details>"
  ].join("\n");
}

function compactDiagnostics(stderr, exitCode) {
  const diagnostics = stderr.replaceAll("\u0000", "").trim();
  if (!diagnostics) {
    return `PlantUML 退出码为 ${exitCode}，但没有返回诊断信息。`;
  }
  return diagnostics.length > 4000 ? `${diagnostics.slice(0, 4000)}\n...` : diagnostics;
}

function runPlantUmlProcess(javaCommand, args, source) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaCommand, args, {
      cwd: PLUGIN_ROOT,
      env: {
        ...process.env,
        PLANTUML_SECURITY_PROFILE: SECURITY_PROFILE,
        PLANTUML_LIMIT_SIZE: "4096"
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure;
    let settled = false;
    const timeout = setTimeout(() => {
      failure = new RenderError(`PlantUML 渲染超过 ${RENDER_TIMEOUT_MS / 1000} 秒，已终止。`);
      child.kill();
    }, RENDER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        failure = new RenderError(`PlantUML 输出不能超过 ${MAX_OUTPUT_BYTES / 1024 / 1024} MiB。`);
        child.kill();
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= MAX_STDERR_BYTES) {
        return;
      }
      const accepted = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes);
      stderrBytes += accepted.length;
      stderrChunks.push(accepted);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      reject(new RenderError(`无法启动 PlantUML：${error.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      if (failure) {
        reject(failure);
        return;
      }
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (exitCode !== 0) {
        reject(new RenderError(compactDiagnostics(stderr, exitCode)));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !failure) {
        failure = new RenderError(`无法向 PlantUML 写入源码：${error.message}`);
        child.kill();
      }
    });
    child.stdin.end(source, "utf8");
  });
}

function verifyOutput(output, format) {
  if (format === "png" && !output.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new RenderError("PlantUML 没有返回有效的 PNG 文件。");
  }
  if (format === "svg" && !output.toString("utf8", 0, Math.min(output.length, 2048)).includes("<svg")) {
    throw new RenderError("PlantUML 没有返回有效的 SVG 文件。");
  }
}

function rememberOutput(outputPath, output) {
  memoryOutputCache.delete(outputPath);
  memoryOutputCache.set(outputPath, output);
  if (memoryOutputCache.size > MAX_MEMORY_CACHE_ENTRIES) {
    memoryOutputCache.delete(memoryOutputCache.keys().next().value);
  }
}

async function readCachedOutput(outputPath, format) {
  const memoryOutput = memoryOutputCache.get(outputPath);
  if (memoryOutput) {
    rememberOutput(outputPath, memoryOutput);
    return { output: memoryOutput, cacheStatus: "memory" };
  }

  try {
    const output = await readFile(outputPath);
    verifyOutput(output, format);
    rememberOutput(outputPath, output);
    return { output, cacheStatus: "disk" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof RenderError) {
      await rm(outputPath, { force: true });
      return undefined;
    }
    throw error;
  }
}

async function renderOutput({
  outputPath,
  format,
  normalizedSource,
  javaCommand,
  jarPath
}) {
  const cached = await readCachedOutput(outputPath, format);
  if (cached) {
    return cached;
  }

  let renderPromise = activeRenders.get(outputPath);
  let cacheStatus = "shared";
  if (!renderPromise) {
    cacheStatus = "rendered";
    renderPromise = (async () => {
      const args = [
        "-Xmx512m",
        "-Djava.awt.headless=true",
        `-DPLANTUML_SECURITY_PROFILE=${SECURITY_PROFILE}`,
        "-jar",
        jarPath,
        `--${format}`,
        "--pipe",
        "--check-before-run",
        "--stop-on-error",
        "--no-error-image",
        "--disable-metadata",
        "--charset",
        "UTF-8"
      ];
      const result = await runPlantUmlProcess(javaCommand, args, normalizedSource);
      verifyOutput(result.stdout, format);
      await writeFile(outputPath, result.stdout);
      rememberOutput(outputPath, result.stdout);
      return result.stdout;
    })();
    activeRenders.set(outputPath, renderPromise);
  }

  try {
    return { output: await renderPromise, cacheStatus };
  } finally {
    if (activeRenders.get(outputPath) === renderPromise) {
      activeRenders.delete(outputPath);
    }
  }
}

export async function renderPlantUml({ source, format = "svg", name }) {
  const startedAt = performance.now();
  const normalizedSource = normalizeSource(source);
  if (!["png", "svg"].includes(format)) {
    throw new RenderError("输出格式只能是 png 或 svg。");
  }

  const metadata = await resolvePlantUmlMetadata();
  if (metadata.minimumJavaVersion !== MINIMUM_JAVA_VERSION) {
    throw new RenderError("PlantUML 元数据与插件支持的最低 Java 版本不一致。");
  }
  const javaRuntime = await resolveJavaRuntime();
  const dataRoot = resolveDataRoot();
  const plantUmlRuntime = await ensurePlantUmlJar({ dataRoot, metadata });
  const outputDirectory = path.join(dataRoot, "output");
  await mkdir(outputDirectory, { recursive: true });

  const digest = createHash("sha256")
    .update(metadata.version)
    .update("\0")
    .update(format)
    .update("\0")
    .update(normalizedSource)
    .digest("hex")
    .slice(0, 16);
  const outputPath = path.join(outputDirectory, `${sanitizeName(name)}-${digest}.${format}`);
  const { output, cacheStatus } = await renderOutput({
    outputPath,
    format,
    normalizedSource,
    javaCommand: javaRuntime.command,
    jarPath: plantUmlRuntime.path
  });
  const mimeType = format === "png" ? "image/png" : "image/svg+xml";
  return {
    path: outputPath,
    markdown: `![PlantUML 图](${markdownPath(outputPath)})`,
    format,
    mimeType,
    bytes: output.length,
    data: output,
    source: normalizedSource.trimEnd(),
    cacheStatus,
    runtimeCacheStatus: plantUmlRuntime.cacheStatus,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    plantUmlVersion: metadata.version,
    javaVersion: javaRuntime.majorVersion,
    securityProfile: SECURITY_PROFILE
  };
}

export function createServer() {
  const server = new McpServer({ name: "plantuml-renderer", version: "1.0.0" });
  server.registerTool(
    "render_plantuml",
    {
      title: "渲染 PlantUML",
      description: "在本机以 SANDBOX 安全配置把 PlantUML 源码渲染为 PNG 或 SVG；首次使用会从官方来源下载并校验固定 JAR。",
      inputSchema: {
        source: z.string().describe("包含 @start... 与 @end... 标记的完整 PlantUML 源码。"),
        format: z.enum(["png", "svg"]).default("svg").describe("输出格式。默认使用 SVG。"),
        name: z.string().trim().min(1).max(80).optional().describe("可选的输出文件基础名称。")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ source, format, name }) => {
      try {
        const result = await renderPlantUml({ source, format, name });
        const summaryLines = [
          `已生成 ${result.format.toUpperCase()}：${result.path}`,
          `Markdown：${result.markdown}`,
          `耗时：${result.durationMs} ms`,
          `输出缓存：${result.cacheStatus}`,
          `PlantUML 运行时：${result.runtimeCacheStatus}`,
          `PlantUML：${result.plantUmlVersion}`,
          `Java：${result.javaVersion}`,
          `安全配置：${result.securityProfile}`
        ];
        if (result.format === "svg") {
          summaryLines.push("", collapsiblePlantUmlSource(result.source));
        }
        const content = [{ type: "text", text: summaryLines.join("\n") }];
        if (result.format === "png") {
          content.push({ type: "image", data: result.data.toString("base64"), mimeType: result.mimeType });
        }
        return { content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `PlantUML 渲染失败：${message}` }]
        };
      }
    }
  );
  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
