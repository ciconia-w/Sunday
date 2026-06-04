import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

async function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(String(stderr || stdout || error.message || error)));
                return;
            }
            resolve(String(stdout || ""));
        });
    });
}

const tempRoot = await mkdtemp(join(tmpdir(), "sunday-skills-verify-"));
const managedSkillsRoot = join(tempRoot, "managed-skills");
const importSourceRoot = join(tempRoot, "import-source");
const importSkillDir = join(importSourceRoot, "sample-local-skill");
const githubRepoRoot = join(tempRoot, "github-source");
const githubSkillDir = join(githubRepoRoot, "skills", "sample-github-skill");

await mkdir(managedSkillsRoot, { recursive: true });
await mkdir(importSkillDir, { recursive: true });
await mkdir(githubSkillDir, { recursive: true });
await writeFile(
    join(importSkillDir, "SKILL.md"),
    [
        "---",
        "name: sample-local-skill",
        "---",
        "",
        "Sample imported skill for Sunday verification.",
        "",
        "Use this skill to verify local import and removal.",
    ].join("\n"),
    "utf8",
);
await writeFile(
    join(githubSkillDir, "SKILL.md"),
    [
        "---",
        "name: sample-github-skill",
        "---",
        "",
        "Sample GitHub-imported skill for Sunday verification.",
        "",
        "Use this skill to verify repository clone import and removal.",
    ].join("\n"),
    "utf8",
);
await runCommand("git", ["init", "-b", "main"], githubRepoRoot);
await runCommand("git", ["add", "."], githubRepoRoot);
await runCommand(
    "git",
    ["-c", "user.name=Sunday Verify", "-c", "user.email=sunday-verify@example.com", "commit", "-m", "Add sample skill"],
    githubRepoRoot,
);

let exitCode = 1;

try {
    exitCode = await withSidecarRuntime(
        {
            sidecarPort: 8807,
            env: {
                PERSONAL_AGENT_SKILLS_USER_DIR: managedSkillsRoot,
            },
        },
        async ({ sidecarPort }) => {
            const baseUrl = `http://127.0.0.1:${sidecarPort}`;
            const skillsData = await post(baseUrl, "/skills/data", {});
            const firstSkill = skillsData.result?.[0] ?? null;

            let toggleResult = null;
            let hasResult = null;
            let importResult = null;
            let importedHasResult = null;
            let removeImportedResult = null;
            let githubImportResult = null;
            let githubImportedHasResult = null;
            let removeGithubImportedResult = null;
            let reloadedSkillsData = null;
            let removeMissingResult = null;

            if (firstSkill?.name) {
                toggleResult = await post(baseUrl, "/skills/set-enabled", {
                    skillName: firstSkill.name,
                    enabled: firstSkill.enabled === true ? false : true,
                });

                hasResult = await post(baseUrl, "/skills/has", {
                    skillName: firstSkill.name,
                });
            }

            importResult = await post(baseUrl, "/skills/import-local", {
                sourcePath: importSkillDir,
            });

            importedHasResult = await post(baseUrl, "/skills/has", {
                skillName: "sample-local-skill",
            });

            removeImportedResult = await post(baseUrl, "/skills/remove", {
                skillName: "sample-local-skill",
            });

            githubImportResult = await post(baseUrl, "/skills/import-github", {
                repoInput: githubRepoRoot,
            });

            githubImportedHasResult = await post(baseUrl, "/skills/has", {
                skillName: "sample-github-skill",
            });

            removeGithubImportedResult = await post(baseUrl, "/skills/remove", {
                skillName: "sample-github-skill",
            });

            reloadedSkillsData = await post(baseUrl, "/skills/data", {});
            removeMissingResult = await post(baseUrl, "/skills/remove", {
                skillName: "__nonexistent_skill__",
            });

            const uniqueSources = Array.isArray(skillsData.result)
                ? [...new Set(skillsData.result.map((skill) => skill?.source).filter(Boolean))]
                : [];
            const importedSkillStillPresent = Array.isArray(reloadedSkillsData?.result)
                ? reloadedSkillsData.result.some((skill) =>
                    skill?.name === "sample-local-skill" || skill?.name === "sample-github-skill")
                : false;

            const verdict =
                skillsData.ok === true &&
                Array.isArray(skillsData.result) &&
                skillsData.result.length > 0 &&
                typeof firstSkill?.path === "string" &&
                firstSkill.path.length > 0 &&
                typeof firstSkill?.description === "string" &&
                firstSkill.description.trim() !== "---" &&
                toggleResult?.ok === true &&
                hasResult?.ok === true &&
                typeof hasResult?.result === "boolean" &&
                importResult?.ok === true &&
                importResult?.result?.name === "sample-local-skill" &&
                importResult?.result?.source === "local" &&
                importedHasResult?.ok === true &&
                importedHasResult?.result === true &&
                removeImportedResult?.ok === true &&
                removeImportedResult?.result === true &&
                githubImportResult?.ok === true &&
                githubImportResult?.result?.name === "sample-github-skill" &&
                githubImportResult?.result?.source === "local" &&
                githubImportedHasResult?.ok === true &&
                githubImportedHasResult?.result === true &&
                removeGithubImportedResult?.ok === true &&
                removeGithubImportedResult?.result === true &&
                reloadedSkillsData?.ok === true &&
                importedSkillStillPresent === false &&
                removeMissingResult?.ok === true &&
                removeMissingResult?.result === false
                    ? "skills-api-confirmed"
                    : "skills-api-incomplete";

            console.log(
                JSON.stringify(
                    {
                        sidecarPort,
                        count: Array.isArray(skillsData.result) ? skillsData.result.length : 0,
                        uniqueSources,
                        firstSkill,
                        toggleResult,
                        hasResult,
                        importResult,
                        importedHasResult,
                        removeImportedResult,
                        githubImportResult,
                        githubImportedHasResult,
                        removeGithubImportedResult,
                        removeMissingResult,
                        importedSkillStillPresent,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            return verdict === "skills-api-confirmed" ? 0 : 1;
        },
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}

process.exit(exitCode ?? 1);
