import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseJavaMajorVersion,
  renderPlantUml
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
