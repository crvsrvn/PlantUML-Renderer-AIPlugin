import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ensurePlantUmlJar,
  validatePlantUmlMetadata
} from "../../plugins/plantuml-renderer/scripts/plantuml-runtime.mjs";

function metadataFor(bytes, overrides = {}) {
  return {
    version: "1.2.3",
    source: "https://example.test/plantuml.jar",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    minimumJavaVersion: 11,
    ...overrides
  };
}

function responseFor(bytes, headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-length": String(bytes.length),
      ...headers
    }
  });
}

async function withTemporaryData(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plantuml-runtime-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("首次下载并在后续调用中复用已校验的 JAR", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("verified-plantuml-jar");
    const metadata = metadataFor(bytes);
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return responseFor(bytes);
    };

    const downloaded = await ensurePlantUmlJar({ dataRoot, metadata, fetchImpl });
    const cached = await ensurePlantUmlJar({ dataRoot, metadata, fetchImpl });

    assert.equal(downloaded.cacheStatus, "downloaded");
    assert.equal(cached.cacheStatus, "hit");
    assert.equal(requests, 1);
    assert.deepEqual(await readFile(downloaded.path), bytes);
  });
});

test("损坏的缓存会被重新下载替换", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("replacement-jar");
    const metadata = metadataFor(bytes);
    const runtimeDirectory = path.join(dataRoot, "runtime", "plantuml", metadata.version);
    const jarPath = path.join(runtimeDirectory, "plantuml.jar");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(jarPath, "corrupt");

    const result = await ensurePlantUmlJar({
      dataRoot,
      metadata,
      fetchImpl: async () => responseFor(bytes)
    });

    assert.equal(result.cacheStatus, "downloaded");
    assert.deepEqual(await readFile(jarPath), bytes);
  });
});

test("并发调用只执行一次下载", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("concurrent-jar");
    const metadata = metadataFor(bytes);
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return responseFor(bytes);
    };

    const results = await Promise.all([
      ensurePlantUmlJar({ dataRoot, metadata, fetchImpl }),
      ensurePlantUmlJar({ dataRoot, metadata, fetchImpl }),
      ensurePlantUmlJar({ dataRoot, metadata, fetchImpl })
    ]);

    assert.equal(requests, 1);
    assert.equal(new Set(results.map((result) => result.path)).size, 1);
    assert.ok(results.every((result) => result.cacheStatus === "downloaded"));
  });
});

test("SHA-256 不匹配时不保留 JAR 或临时文件", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("untrusted-jar");
    const metadata = metadataFor(bytes, { sha256: "0".repeat(64) });

    await assert.rejects(
      ensurePlantUmlJar({
        dataRoot,
        metadata,
        fetchImpl: async () => responseFor(bytes)
      }),
      /SHA-256 校验失败/
    );

    const runtimeDirectory = path.join(dataRoot, "runtime", "plantuml", metadata.version);
    const files = await readdir(runtimeDirectory);
    assert.deepEqual(files, []);
  });
});

test("拒绝超过大小限制的下载", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.alloc(32, 1);
    const metadata = metadataFor(bytes);

    await assert.rejects(
      ensurePlantUmlJar({
        dataRoot,
        metadata,
        fetchImpl: async () => responseFor(bytes),
        maxBytes: 16
      }),
      /超过允许/
    );
  });
});

test("离线时仍可使用已校验缓存", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("offline-cache");
    const metadata = metadataFor(bytes);
    const runtimeDirectory = path.join(dataRoot, "runtime", "plantuml", metadata.version);
    const jarPath = path.join(runtimeDirectory, "plantuml.jar");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(jarPath, bytes);

    const result = await ensurePlantUmlJar({
      dataRoot,
      metadata,
      fetchImpl: async () => {
        throw new Error("不应访问网络");
      }
    });

    assert.equal(result.cacheStatus, "hit");
    await access(result.path);
  });
});

test("版本元数据必须使用 HTTPS 和合法 SHA-256", () => {
  const bytes = Buffer.from("metadata");
  assert.throws(
    () => validatePlantUmlMetadata(metadataFor(bytes, { source: "http://example.test/a.jar" })),
    /HTTPS/
  );
  assert.throws(
    () => validatePlantUmlMetadata(metadataFor(bytes, { sha256: "invalid" })),
    /SHA-256/
  );
});

test("拒绝重定向到非 HTTPS 地址", async () => {
  await withTemporaryData(async (dataRoot) => {
    const bytes = Buffer.from("redirected-jar");
    const metadata = metadataFor(bytes);
    const response = responseFor(bytes);

    await assert.rejects(
      ensurePlantUmlJar({
        dataRoot,
        metadata,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          url: "http://example.test/plantuml.jar",
          headers: response.headers,
          body: response.body
        })
      }),
      /重定向.*HTTPS/
    );
  });
});
