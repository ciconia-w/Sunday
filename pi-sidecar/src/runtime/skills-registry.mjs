import { readdir, readFile } from "node:fs/promises";
import { join, basename, relative, sep } from "node:path";
import { homedir } from "node:os";

function detectSource(root, skillDir) {
    if (root.source && root.source !== "auto") {
        return root.source;
    }

    const relPath = relative(root.dir, skillDir);
    const pathParts = relPath.split(sep).filter(Boolean);
    if (pathParts.includes(".system") || basename(skillDir).startsWith(".")) {
        return "builtin";
    }
    return "local";
}

function extractDescription(markdown) {
    const normalizedMarkdown = markdown.replace(/^---[\s\S]*?\n---\s*/m, "");
    const lines = normalizedMarkdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) =>
            line.length > 0 &&
            !line.startsWith("#") &&
            line !== "---" &&
            line !== "***" &&
            !line.startsWith("<!--") &&
            !line.endsWith("-->")
        );

    return lines[0] ?? "";
}

export class SkillsRegistry {
    constructor(options = {}) {
        const normalizedRoots = Array.isArray(options.roots) && options.roots.length > 0
            ? options.roots
            : [{ dir: options.baseDir ?? join(homedir(), ".codex", "skills"), source: "auto" }];
        this.roots = normalizedRoots.map((root) => {
            if (typeof root === "string") {
                return { dir: root, source: "auto" };
            }
            return {
                dir: root.dir,
                source: root.source ?? "auto",
            };
        });
        this.skills = [];
        this.enabledByName = new Map();
    }

    async collectSkillDirectories(rootDir) {
        const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
        const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
        if (hasSkillFile) {
            return [rootDir];
        }

        const directories = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            directories.push(...(await this.collectSkillDirectories(join(rootDir, entry.name))));
        }
        return directories;
    }

    async reload() {
        const collected = new Map();

        for (const root of this.roots) {
            const skillDirs = await this.collectSkillDirectories(root.dir);
            for (const skillDir of skillDirs) {
                const name = basename(skillDir);
                if (collected.has(name)) {
                    continue;
                }

                const skillFile = join(skillDir, "SKILL.md");
                const markdown = await readFile(skillFile, "utf8").catch(() => "");
                if (!markdown) {
                    continue;
                }

                collected.set(name, {
                    name,
                    description: extractDescription(markdown),
                    path: skillDir,
                    source: detectSource(root, skillDir),
                    enabled: this.enabledByName.get(name) ?? true,
                });
            }
        }

        this.skills = [...collected.values()].sort((left, right) => left.name.localeCompare(right.name));
        return this.skills;
    }

    getSkills() {
        return this.skills;
    }

    setSkillEnabled(skillName, enabled) {
        const skill = this.skills.find((item) => item.name === skillName);
        if (!skill) {
            return false;
        }
        skill.enabled = enabled;
        this.enabledByName.set(skillName, enabled);
        return true;
    }

    hasSkill(skillName) {
        return this.skills.some((item) => item.name === skillName);
    }

    removeSkill(skillName) {
        const index = this.skills.findIndex((item) => item.name === skillName);
        if (index < 0) {
            return false;
        }
        this.skills.splice(index, 1);
        this.enabledByName.delete(skillName);
        return true;
    }
}
