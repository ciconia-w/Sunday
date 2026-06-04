import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const skillsChannelPath = join(repoRoot, "host-qt", "src", "channels", "skillschannel.cpp");
const skillsRegistryPath = join(repoRoot, "pi-sidecar", "src", "runtime", "skills-registry.mjs");

const [skillsChannelSource, skillsRegistrySource] = await Promise.all([
    readFile(skillsChannelPath, "utf8"),
    readFile(skillsRegistryPath, "utf8"),
]);

const checks = {
    hostUsesDirectoryPicker: skillsChannelSource.includes("QFileDialog::getExistingDirectory"),
    hostPostsImportEndpoint: skillsChannelSource.includes("/skills/import-local"),
    hostPostsGithubImportEndpoint: skillsChannelSource.includes("/skills/import-github"),
    hostNoLongerStubbed: !skillsChannelSource.includes("not implemented"),
    registrySupportsImport: skillsRegistrySource.includes("async importSkill("),
    registrySupportsGithubImport: skillsRegistrySource.includes("async importGithubSkill("),
    registryParsesGithubSpec: skillsRegistrySource.includes("github.com")
        && skillsRegistrySource.includes("owner/repo"),
    registrySupportsManagedRemoval: skillsRegistrySource.includes("async removeSkill(")
        && skillsRegistrySource.includes("skill.source !== \"local\""),
};

const verdict = Object.values(checks).every(Boolean)
    ? "skills-import-source-confirmed"
    : "skills-import-source-incomplete";

console.log(JSON.stringify({ checks, verdict }, null, 2));
process.exit(verdict === "skills-import-source-confirmed" ? 0 : 1);
