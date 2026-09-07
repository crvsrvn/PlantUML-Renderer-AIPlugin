import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  MarkdownEmbedError,
  buildEmbedBlock,
  findEmbedBlock,
  isMarkdownPath,
  markdownHref,
  sanitizeAssetName,
  upsertEmbedBlock
} from "../../plugins/plantuml-renderer/scripts/markdown-embed.mjs";

test("资源名保留中文并清掉路径分隔符", () => {
  assert.equal(sanitizeAssetName("状态机/结构 图"), "状态机-结构-图");
  assert.equal(sanitizeAssetName("  fsm-bake  "), "fsm-bake");
});

test("无法安全命名时报错", () => {
  assert.throws(() => sanitizeAssetName("///"), MarkdownEmbedError);
  assert.throws(() => sanitizeAssetName("nul"), MarkdownEmbedError);
});

test("只接受 Markdown 扩展名", () => {
  assert.equal(isMarkdownPath("a.md"), true);
  assert.equal(isMarkdownPath("a.MARKDOWN"), true);
  assert.equal(isMarkdownPath("a.txt"), false);
});

test("图片引用使用相对路径并转义空格", () => {
  const directory = path.resolve("/docs");
  assert.equal(markdownHref(directory, path.join(directory, "图 1.svg")), "./%E5%9B%BE%201.svg");
  assert.equal(markdownHref(directory, path.join(directory, "assets", "a.svg")), "./assets/a.svg");
});

test("首次插入追加到文末并保留原有内容", () => {
  const block = buildEmbedBlock({ id: "fsm", href: "./fsm.svg" });
  const { text, action } = upsertEmbedBlock("# 标题\n\n正文\n", { id: "fsm", block });

  assert.equal(action, "appended");
  assert.match(text, /# 标题\n\n正文\n\n<!-- plantuml-begin: fsm -->\n!\[fsm\]\(\.\/fsm\.svg\)\n<!-- plantuml-end: fsm -->\n$/);
});

test("同名标记块原地更新且不重复", () => {
  const first = upsertEmbedBlock("# 标题\n", {
    id: "fsm",
    block: buildEmbedBlock({ id: "fsm", href: "./fsm.svg" })
  }).text;
  const { text, action } = upsertEmbedBlock(first, {
    id: "fsm",
    block: buildEmbedBlock({ id: "fsm", href: "./fsm.svg", caption: "更新后" })
  });

  assert.equal(action, "replaced");
  assert.equal(text.match(/plantuml-begin: fsm/g).length, 1);
  assert.match(text, /\*更新后\*/);
});

test("按锚点插入到指定标题之后", () => {
  const markdown = "# 标题\n\n## 状态机结构\n\n段落\n\n## 其他\n";
  const { text, action } = upsertEmbedBlock(markdown, {
    id: "fsm",
    block: buildEmbedBlock({ id: "fsm", href: "./fsm.svg" }),
    anchor: "## 状态机结构"
  });

  assert.equal(action, "inserted");
  assert.ok(text.indexOf("plantuml-begin") > text.indexOf("## 状态机结构"));
  assert.ok(text.indexOf("plantuml-end") < text.indexOf("段落"));
});

test("锚点不存在时报错", () => {
  assert.throws(
    () =>
      upsertEmbedBlock("# 标题\n", {
        id: "fsm",
        block: buildEmbedBlock({ id: "fsm", href: "./fsm.svg" }),
        anchor: "## 不存在"
      }),
    MarkdownEmbedError
  );
});

test("CRLF 文档写回后仍是 CRLF", () => {
  const { text } = upsertEmbedBlock("# 标题\r\n\r\n正文\r\n", {
    id: "fsm",
    block: buildEmbedBlock({ id: "fsm", href: "./fsm.svg" })
  });

  assert.ok(text.includes("\r\n"));
  assert.equal(/[^\r]\n/.test(text), false);
});

test("标记块 ID 中的正则元字符不会破坏匹配", () => {
  const id = "fsm(1).v2";
  const block = buildEmbedBlock({ id, href: "./a.svg" });
  const text = upsertEmbedBlock("# 标题\n", { id, block }).text;

  assert.ok(findEmbedBlock(text, id));
  assert.equal(findEmbedBlock(text, "fsm.1..v2"), undefined);
});
