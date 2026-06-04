import { cp, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { join, basename, relative, resolve, sep } from "node:path";
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
        this.managedRootDir = options.managedRootDir
            ?? this.roots.find((root) => root.source === "auto")?.dir
            ?? this.roots[0]?.dir
            ?? join(homedir(), ".codex", "skills");
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

    async importSkill(sourcePath) {
        const normalizedInput = typeof sourcePath === "string" ? sourcePath.trim() : "";
        if (!normalizedInput) {
            throw new Error("技能目录不能为空");
        }

        await this.reload();

        const resolvedInput = resolve(normalizedInput);
        let sourceSkillDir = resolvedInput;
        let sourceStat = await stat(sourceSkillDir).catch(() => null);

        if (!sourceStat) {
            throw new Error("所选技能目录不存在");
        }

        if (!sourceStat.isDirectory() && basename(sourceSkillDir) === "SKILL.md") {
            sourceSkillDir = resolve(sourceSkillDir, "..");
            sourceStat = await stat(sourceSkillDir).catch(() => null);
        }

        if (!sourceStat?.isDirectory()) {
            throw new Error("请选择包含 SKILL.md 的技能目录");
        }

        const sourceSkillFile = join(sourceSkillDir, "SKILL.md");
        const skillFileStat = await stat(sourceSkillFile).catch(() => null);
        if (!skillFileStat?.isFile()) {
            throw new Error("所选目录缺少 SKILL.md");
        }

        const skillName = basename(sourceSkillDir);
        const existingSkill = this.skills.find((item) => item.name === skillName);
        if (existingSkill) {
            const [existingRealPath, sourceRealPath] = await Promise.all([
                realpath(existingSkill.path).catch(() => existingSkill.path),
                realpath(sourceSkillDir).catch(() => sourceSkillDir),
            ]);

            if (existingRealPath === sourceRealPath) {
                return {
                    ...existingSkill,
                    imported: false,
                    alreadyPresent: true,
                };
            }

            throw new Error(`技能已存在：${skillName}`);
        }

        await mkdir(this.managedRootDir, { recursive: true });
        const destinationPath = join(this.managedRootDir, skillName);
        const destinationStat = await stat(destinationPath).catch(() => null);
        if (destinationStat) {
            throw new Error(`目标目录已存在：${destinationPath}`);
        }

        await cp(sourceSkillDir, destinationPath, {
            recursive: true,
            force: false,
            errorOnExist: true,
        });

        await this.reload();

        const importedSkill = this.skills.find((item) => item.name === skillName);
        if (!importedSkill) {
            throw new Error(`导入后未找到技能：${skillName}`);
        }

        return {
            ...importedSkill,
            imported: true,
            alreadyPresent: false,
        };
    }

    async removeSkill(skillName) {
        const skill = this.skills.find((item) => item.name === skillName);
        if (!skill || skill.source !== "local") {
            return false;
        }

        const managedRootRealPath = await realpath(this.managedRootDir).catch(() => this.managedRootDir);
        const skillRealPath = await realpath(skill.path).catch(() => skill.path);
        const relativeToManagedRoot = relative(managedRootRealPath, skillRealPath);
        if (!relativeToManagedRoot || relativeToManagedRoot.startsWith("..") || relativeToManagedRoot.includes(`${sep}..`)) {
            return false;
        }

        await rm(skill.path, { recursive: true, force: true });
        this.skills = this.skills.filter((item) => item.name !== skillName);
        this.enabledByName.delete(skillName);
        return true;
    }
}
