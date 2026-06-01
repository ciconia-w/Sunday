import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

function detectSource(skillDirName) {
    if (skillDirName.startsWith(".")) {
        return "builtin";
    }
    return "local";
}

function extractDescription(markdown) {
    const lines = markdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

    return lines[0] ?? "";
}

export class SkillsRegistry {
    constructor(options = {}) {
        this.baseDir = options.baseDir ?? join(homedir(), ".codex", "skills");
        this.skills = [];
        this.enabledByName = new Map();
    }

    async reload() {
        const entries = await readdir(this.baseDir, { withFileTypes: true }).catch(() => []);
        const skills = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const skillDir = join(this.baseDir, entry.name);
            const skillFile = join(skillDir, "SKILL.md");
            const markdown = await readFile(skillFile, "utf8").catch(() => "");
            if (!markdown) {
                continue;
            }

            const name = basename(entry.name);
            skills.push({
                name,
                description: extractDescription(markdown),
                path: skillDir,
                source: detectSource(entry.name),
                enabled: this.enabledByName.get(name) ?? true,
            });
        }

        this.skills = skills.sort((left, right) => left.name.localeCompare(right.name));
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
