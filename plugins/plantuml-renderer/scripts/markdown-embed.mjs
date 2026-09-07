import path from "node:path";

const MAX_ASSET_NAME_LENGTH = 64;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_NAME_CHARACTERS = /[\\/:*?"<>|]+/g;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

export class MarkdownEmbedError extends Error {}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceControlCharacters(text) {
  let result = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    result += codePoint < 0x20 || codePoint === 0x7f ? "-" : character;
  }
  return result;
}

// Markdown 里的资源名允许中文，只移除路径分隔符和文件系统保留字符。
export function sanitizeAssetName(name) {
  const sanitized = replaceControlCharacters(String(name ?? "").normalize("NFC"))
    .replace(UNSAFE_NAME_CHARACTERS, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_ASSET_NAME_LENGTH)
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!sanitized || WINDOWS_RESERVED_NAME.test(sanitized)) {
    throw new MarkdownEmbedError(`图表名称 ${JSON.stringify(name)} 无法作为文件名使用。`);
  }
  return sanitized;
}

export function isMarkdownPath(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function markdownHref(fromDirectory, filePath) {
  const relative = path.relative(fromDirectory, filePath).replaceAll("\\", "/");
  const href = relative.startsWith(".") ? relative : `./${relative}`;
  return encodeURI(href).replaceAll("#", "%23").replaceAll("?", "%3F");
}

export function buildEmbedBlock({ id, href, alt = id, caption }) {
  const lines = [`<!-- plantuml-begin: ${id} -->`, `![${alt}](${href})`];
  if (caption) {
    lines.push("", `*${caption}*`);
  }
  lines.push(`<!-- plantuml-end: ${id} -->`);
  return lines.join("\n");
}

export function findEmbedBlock(text, id) {
  const escapedId = escapeRegExp(id);
  const pattern = new RegExp(
    `<!--\\s*plantuml-begin:\\s*${escapedId}\\s*-->[\\s\\S]*?<!--\\s*plantuml-end:\\s*${escapedId}\\s*-->`
  );
  const match = pattern.exec(text);
  if (!match) {
    return undefined;
  }
  return { start: match.index, end: match.index + match[0].length, text: match[0] };
}

function insertAfterAnchor(text, block, anchor) {
  const anchorIndex = text.indexOf(anchor);
  if (anchorIndex < 0) {
    throw new MarkdownEmbedError(`Markdown 中找不到锚点文本：${anchor}`);
  }
  const lineEnd = text.indexOf("\n", anchorIndex + anchor.length);
  const insertAt = lineEnd < 0 ? text.length : lineEnd;
  const head = text.slice(0, insertAt);
  const tail = text.slice(insertAt).replace(/^\n+/, "");
  return tail ? `${head}\n\n${block}\n\n${tail}` : `${head}\n\n${block}\n`;
}

/**
 * 把渲染结果的引用块写入 Markdown：同名块原地更新，否则按锚点或文末插入。
 */
export function upsertEmbedBlock(markdown, { id, block, anchor }) {
  const usesCrlf = /\r\n/.test(markdown);
  const normalized = markdown.replaceAll("\r\n", "\n");

  let action;
  let updated;
  const existing = findEmbedBlock(normalized, id);
  if (existing) {
    action = "replaced";
    updated = `${normalized.slice(0, existing.start)}${block}${normalized.slice(existing.end)}`;
  } else if (anchor) {
    action = "inserted";
    updated = insertAfterAnchor(normalized, block, anchor);
  } else {
    action = "appended";
    updated = `${normalized.replace(/\s*$/, "")}\n\n${block}\n`;
  }

  if (!updated.endsWith("\n")) {
    updated = `${updated}\n`;
  }
  return { text: usesCrlf ? updated.replaceAll("\n", "\r\n") : updated, action };
}
