import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { generateThirdPartyLicenses } from "./generate-third-party-licenses.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repositoryRoot, "plugins", "plantuml-renderer");
const outputDirectory = path.join(pluginRoot, "dist");

await mkdir(outputDirectory, { recursive: true });
await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [path.join(pluginRoot, "scripts", "server.mjs")],
  outfile: path.join(outputDirectory, "server.mjs"),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  charset: "utf8",
  treeShaking: true,
  legalComments: "eof",
  banner: {
    js: "// 此文件由 npm run build 生成，请勿直接编辑。"
  }
});
await generateThirdPartyLicenses({
  repositoryRoot,
  outputPath: path.join(pluginRoot, "licenses", "THIRD_PARTY_LICENSES.txt")
});
