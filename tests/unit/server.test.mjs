import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parseJavaMajorVersion,
  renderPlantUml,
  resolveDataRoot
} from "../../plugins/plantuml-renderer/scripts/server.mjs";

test("识别现代 OpenJDK 版本", () => {
  assert.equal(parseJavaMajorVersion('openjdk version "21.0.7" 2025-04-15 LTS'), 21);
});

test("识别旧式 Java 版本号", () => {
  assert.equal(parseJavaMajorVersion('java version "1.8.0_452"'), 8);
});

test("无法识别的 Java 输出返回 undefined", () => {
  assert.equal(parseJavaMajorVersion("unknown runtime"), undefined);
});

test("直接调用渲染 API 时拒绝非字符串源码", async () => {
  await assert.rejects(renderPlantUml({ source: 42 }), /必须是字符串/);
});

const DATA_ROOT_VARIABLES = [
  "PLANTUML_RENDERER_DATA",
  "PLUGIN_DATA",
  "CLAUDE_PLUGIN_DATA",
  "LOCALAPPDATA",
  "XDG_CACHE_HOME"
];

// 只保留 overrides 中的数据目录变量，执行完毕后恢复原值。
function withDataRootEnv(overrides, callback) {
  const originals = Object.fromEntries(DATA_ROOT_VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of DATA_ROOT_VARIABLES) {
    if (overrides[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = overrides[name];
    }
  }
  try {
    callback();
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("数据目录优先使用显式环境变量", () => {
  const expected = path.join(os.tmpdir(), "plantuml-data-root-test");
  withDataRootEnv(
    { PLANTUML_RENDERER_DATA: expected, PLUGIN_DATA: path.join(os.tmpdir(), "ignored") },
    () => assert.equal(resolveDataRoot(), path.resolve(expected))
  );
});

test("Codex 提供的 PLUGIN_DATA 会被识别为数据目录", () => {
  const expected = path.join(os.tmpdir(), "plantuml-plugin-data-test");
  withDataRootEnv({ PLUGIN_DATA: expected }, () => {
    assert.equal(resolveDataRoot(), path.resolve(expected));
  });
});

test("Claude Code 提供的 CLAUDE_PLUGIN_DATA 会被识别为数据目录", () => {
  const expected = path.join(os.tmpdir(), "plantuml-claude-plugin-data-test");
  withDataRootEnv({ CLAUDE_PLUGIN_DATA: expected }, () => {
    assert.equal(resolveDataRoot(), path.resolve(expected));
  });
});

test("没有宿主数据目录时落在系统约定的用户缓存目录下", () => {
  const cacheRoot = path.join(os.tmpdir(), "plantuml-user-cache-test");
  withDataRootEnv({ LOCALAPPDATA: cacheRoot, XDG_CACHE_HOME: cacheRoot }, () => {
    const expectedRoot =
      process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches") : cacheRoot;
    assert.equal(resolveDataRoot(), path.join(expectedRoot, "plantuml-renderer"));
  });
});
