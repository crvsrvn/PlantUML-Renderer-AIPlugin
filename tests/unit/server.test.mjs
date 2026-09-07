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

test("数据目录优先使用显式环境变量", () => {
  const original = process.env.PLANTUML_RENDERER_DATA;
  const expected = path.join(os.tmpdir(), "plantuml-data-root-test");
  process.env.PLANTUML_RENDERER_DATA = expected;
  try {
    assert.equal(resolveDataRoot(), path.resolve(expected));
  } finally {
    if (original === undefined) {
      delete process.env.PLANTUML_RENDERER_DATA;
    } else {
      process.env.PLANTUML_RENDERER_DATA = original;
    }
  }
});

test("Codex 提供的 PLUGIN_DATA 会被识别为数据目录", () => {
  const originalData = process.env.PLANTUML_RENDERER_DATA;
  const originalPluginData = process.env.PLUGIN_DATA;
  const expected = path.join(os.tmpdir(), "plantuml-plugin-data-test");
  delete process.env.PLANTUML_RENDERER_DATA;
  process.env.PLUGIN_DATA = expected;
  try {
    assert.equal(resolveDataRoot(), path.resolve(expected));
  } finally {
    if (originalData !== undefined) {
      process.env.PLANTUML_RENDERER_DATA = originalData;
    }
    if (originalPluginData === undefined) {
      delete process.env.PLUGIN_DATA;
    } else {
      process.env.PLUGIN_DATA = originalPluginData;
    }
  }
});

test("没有环境变量时数据目录落在用户目录下", () => {
  const originalData = process.env.PLANTUML_RENDERER_DATA;
  const originalPluginData = process.env.PLUGIN_DATA;
  const originalConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.PLANTUML_RENDERER_DATA;
  delete process.env.PLUGIN_DATA;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.equal(resolveDataRoot(), path.join(os.homedir(), ".claude", "plantuml-renderer"));
  } finally {
    if (originalData !== undefined) {
      process.env.PLANTUML_RENDERER_DATA = originalData;
    }
    if (originalPluginData !== undefined) {
      process.env.PLUGIN_DATA = originalPluginData;
    }
    if (originalConfigDirectory !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDirectory;
    }
  }
});
