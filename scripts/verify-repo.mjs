import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const requiredFiles = [
  "README.md",
  "LICENSE",
  ".editorconfig",
  ".gitattributes",
  ".env.example",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/repo-checks.yml",
];

for (const relativePath of requiredFiles) {
  await access(join(repoRoot, relativePath), fsConstants.F_OK);
}

const gitignore = await readFile(join(repoRoot, ".gitignore"), "utf8");
for (const requiredEntry of [".env.local", "node_modules/", "dist/"]) {
  if (!gitignore.includes(requiredEntry)) {
    throw new Error(`Missing .gitignore entry: ${requiredEntry}`);
  }
}

console.log(JSON.stringify({ ok: true, checked: requiredFiles.length }, null, 2));
