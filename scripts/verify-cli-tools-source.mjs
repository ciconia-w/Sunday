import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const cliStatusPath = join(repoRoot, "pi-sidecar", "src", "runtime", "cli-tools-status.mjs");
const source = await readFile(cliStatusPath, "utf8");

const checks = {
    hasGithubInstallGuide: source.includes("https://cli.github.com/manual/installation"),
    hasOpencliPackageName: source.includes("@jackwener/opencli"),
    hasLarkPackageName: source.includes("@larksuite/cli"),
    hasLatestVersionCache: source.includes("latestVersionCache"),
    hasCopyTextActions: source.includes('actionKind: "copy-text"'),
    hasOpenUrlActions: source.includes('actionKind: "open-url"'),
    hasUpdateAvailableFlag: source.includes("updateAvailable"),
    hasLatestVersionFlag: source.includes("latestVersion"),
};

const verdict = Object.values(checks).every(Boolean)
    ? "cli-tools-source-confirmed"
    : "cli-tools-source-incomplete";

console.log(JSON.stringify({ checks, verdict }, null, 2));
process.exit(verdict === "cli-tools-source-confirmed" ? 0 : 1);
