import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_JAR_BYTES = 64 * 1024 * 1024;
const activeDownloads = new Map();

export class PlantUmlRuntimeError extends Error {}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function validatePlantUmlMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new PlantUmlRuntimeError("PlantUML 版本元数据无效。");
  }

  const version = typeof metadata.version === "string" ? metadata.version.trim() : "";
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    throw new PlantUmlRuntimeError("PlantUML 版本号无效。");
  }

  let source;
  try {
    source = new URL(metadata.source);
  } catch {
    throw new PlantUmlRuntimeError("PlantUML 下载地址无效。");
  }
  if (source.protocol !== "https:") {
    throw new PlantUmlRuntimeError("PlantUML 下载地址必须使用 HTTPS。");
  }

  const sha256 = typeof metadata.sha256 === "string" ? metadata.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new PlantUmlRuntimeError("PlantUML SHA-256 无效。");
  }

  const minimumJavaVersion = Number(metadata.minimumJavaVersion ?? 11);
  if (!Number.isInteger(minimumJavaVersion) || minimumJavaVersion < 1) {
    throw new PlantUmlRuntimeError("PlantUML 最低 Java 版本无效。");
  }

  return {
    ...metadata,
    version,
    source: source.href,
    sha256,
    minimumJavaVersion
  };
}

export async function readPlantUmlMetadata(pluginRoot) {
  const metadataPath = path.join(pluginRoot, "assets", "plantuml-version.json");
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new PlantUmlRuntimeError(`无法读取 PlantUML 版本元数据：${error.message}`);
  }
  return validatePlantUmlMetadata(metadata);
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function hasExpectedHash(filePath, expectedHash) {
  if (!(await fileExists(filePath))) {
    return false;
  }
  return (await sha256File(filePath)) === expectedHash;
}

function toNodeReadable(body) {
  return typeof body?.getReader === "function" ? Readable.fromWeb(body) : body;
}

async function downloadVerifiedJar({
  jarPath,
  metadata,
  fetchImpl,
  timeoutMs,
  maxBytes
}) {
  const temporaryPath = `${jarPath}.${process.pid}.${randomUUID()}.tmp`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(metadata.source, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/java-archive, application/octet-stream;q=0.9, */*;q=0.1",
        "User-Agent": "PlantUML-Renderer-AIPlugin/1.0.0"
      }
    });
    if (!response?.ok) {
      throw new PlantUmlRuntimeError(
        `PlantUML 下载失败：HTTP ${response?.status ?? "unknown"}。`
      );
    }
    if (response.url && new URL(response.url).protocol !== "https:") {
      throw new PlantUmlRuntimeError("PlantUML 下载重定向后的地址必须使用 HTTPS。");
    }
    if (!response.body) {
      throw new PlantUmlRuntimeError("PlantUML 下载响应没有内容。");
    }

    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new PlantUmlRuntimeError(
        `PlantUML JAR 超过允许的 ${Math.floor(maxBytes / 1024 / 1024)} MiB。`
      );
    }

    const hash = createHash("sha256");
    let downloadedBytes = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(
            new PlantUmlRuntimeError(
              `PlantUML JAR 超过允许的 ${Math.floor(maxBytes / 1024 / 1024)} MiB。`
            )
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });

    await pipeline(
      toNodeReadable(response.body),
      verifier,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
      { signal: controller.signal }
    );

    if (downloadedBytes === 0) {
      throw new PlantUmlRuntimeError("PlantUML 下载结果为空。");
    }
    const actualHash = hash.digest("hex");
    if (actualHash !== metadata.sha256) {
      throw new PlantUmlRuntimeError(
        `PlantUML SHA-256 校验失败：期望 ${metadata.sha256}，实际 ${actualHash}。`
      );
    }

    try {
      await rename(temporaryPath, jarPath);
    } catch (error) {
      // 另一个进程可能已先完成相同下载；只接受哈希完全一致的结果。
      if (!(await hasExpectedHash(jarPath, metadata.sha256))) {
        throw error;
      }
    }

    return downloadedBytes;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PlantUmlRuntimeError(
        `PlantUML 下载超过 ${Math.ceil(timeoutMs / 1000)} 秒，已终止。`
      );
    }
    if (error instanceof PlantUmlRuntimeError) {
      throw error;
    }
    throw new PlantUmlRuntimeError(`PlantUML 下载失败：${error.message}`);
  } finally {
    clearTimeout(timeout);
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function ensurePlantUmlJarInternal(options) {
  const {
    dataRoot,
    metadata,
    fetchImpl,
    timeoutMs,
    maxBytes
  } = options;
  const runtimeDirectory = path.join(dataRoot, "runtime", "plantuml", metadata.version);
  const jarPath = path.join(runtimeDirectory, "plantuml.jar");
  await mkdir(runtimeDirectory, { recursive: true });

  if (await hasExpectedHash(jarPath, metadata.sha256)) {
    return {
      path: jarPath,
      cacheStatus: "hit",
      bytes: undefined,
      version: metadata.version
    };
  }

  await rm(jarPath, { force: true });
  const bytes = await downloadVerifiedJar({
    jarPath,
    metadata,
    fetchImpl,
    timeoutMs,
    maxBytes
  });
  if (!(await hasExpectedHash(jarPath, metadata.sha256))) {
    await rm(jarPath, { force: true });
    throw new PlantUmlRuntimeError("PlantUML JAR 发布后校验失败。");
  }

  return {
    path: jarPath,
    cacheStatus: "downloaded",
    bytes,
    version: metadata.version
  };
}

export async function ensurePlantUmlJar({
  dataRoot,
  metadata,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_JAR_BYTES
}) {
  if (typeof fetchImpl !== "function") {
    throw new PlantUmlRuntimeError("当前 Node.js 运行时不支持 fetch。");
  }
  if (!dataRoot || typeof dataRoot !== "string") {
    throw new PlantUmlRuntimeError("PLUGIN_DATA 目录无效。");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PlantUmlRuntimeError("PlantUML 下载超时设置无效。");
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new PlantUmlRuntimeError("PlantUML 下载大小限制无效。");
  }

  const validatedMetadata = validatePlantUmlMetadata(metadata);
  const resolvedDataRoot = path.resolve(dataRoot);
  const jarPath = path.join(
    resolvedDataRoot,
    "runtime",
    "plantuml",
    validatedMetadata.version,
    "plantuml.jar"
  );
  const downloadKey = `${jarPath}\0${validatedMetadata.sha256}`;

  let downloadPromise = activeDownloads.get(downloadKey);
  if (!downloadPromise) {
    downloadPromise = ensurePlantUmlJarInternal({
      dataRoot: resolvedDataRoot,
      metadata: validatedMetadata,
      fetchImpl,
      timeoutMs,
      maxBytes
    });
    activeDownloads.set(downloadKey, downloadPromise);
  }

  try {
    return await downloadPromise;
  } finally {
    if (activeDownloads.get(downloadKey) === downloadPromise) {
      activeDownloads.delete(downloadKey);
    }
  }
}
