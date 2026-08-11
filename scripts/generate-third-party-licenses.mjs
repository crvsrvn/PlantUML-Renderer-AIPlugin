import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function repositoryUrl(repository) {
  if (typeof repository === "string") {
    return repository;
  }
  return repository?.url;
}

async function licenseFiles(packageDirectory) {
  const names = await readdir(packageDirectory);
  return names
    .filter((name) => LICENSE_FILE_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right));
}

export async function generateThirdPartyLicenses({ repositoryRoot, outputPath }) {
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"));
  const packageDirectories = Object.entries(lock.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath.startsWith("node_modules/") && !metadata.dev)
    .map(([packagePath]) => packagePath)
    .sort((left, right) => left.localeCompare(right));

  const sections = [
    "PlantUML Renderer AIPlugin - 第三方依赖许可证",
    "",
    "本文件由 npm run build 根据 package-lock.json 和已安装依赖确定性生成。",
    "PlantUML JAR 不包含在本构建产物中，其声明见仓库根目录 THIRD_PARTY_NOTICES.md。"
  ];

  for (const packagePath of packageDirectories) {
    const packageDirectory = path.join(repositoryRoot, packagePath);
    const packageData = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
    const files = await licenseFiles(packageDirectory);
    if (files.length === 0) {
      throw new Error(`${packageData.name}@${packageData.version} 缺少可随发行版附带的许可证文件。`);
    }

    sections.push("", "=".repeat(80));
    sections.push(`${packageData.name}@${packageData.version}`);
    sections.push(`声明的许可证：${packageData.license ?? "未声明"}`);
    const source = repositoryUrl(packageData.repository);
    if (source) {
      sections.push(`源代码：${source}`);
    }

    for (const file of files) {
      const content = (await readFile(path.join(packageDirectory, file), "utf8"))
        .replaceAll("\r\n", "\n")
        .trim();
      sections.push("", `--- ${file} ---`, "", content);
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${sections.join("\n")}\n`, "utf8");
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await generateThirdPartyLicenses({
    repositoryRoot,
    outputPath: path.join(
      repositoryRoot,
      "plugins",
      "plantuml-renderer",
      "licenses",
      "THIRD_PARTY_LICENSES.txt"
    )
  });
}
