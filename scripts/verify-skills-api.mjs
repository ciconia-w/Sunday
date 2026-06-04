import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime(
    {
        sidecarPort: 8807,
    },
    async ({ sidecarPort }) => {
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const skillsData = await post(baseUrl, "/skills/data", {});
        const firstSkill = skillsData.result?.[0] ?? null;

        let toggleResult = null;
        let hasResult = null;
        let removeResult = null;

        if (firstSkill?.name) {
            toggleResult = await post(baseUrl, "/skills/set-enabled", {
                skillName: firstSkill.name,
                enabled: firstSkill.enabled === true ? false : true,
            });

            hasResult = await post(baseUrl, "/skills/has", {
                skillName: firstSkill.name,
            });

            removeResult = await post(baseUrl, "/skills/remove", {
                skillName: "__nonexistent_skill__",
            });
        }

        const uniqueSources = Array.isArray(skillsData.result)
            ? [...new Set(skillsData.result.map((skill) => skill?.source).filter(Boolean))]
            : [];

        const verdict =
            skillsData.ok === true &&
            Array.isArray(skillsData.result) &&
            skillsData.result.length > 0 &&
            toggleResult?.ok === true &&
            hasResult?.ok === true &&
            typeof hasResult?.result === "boolean" &&
            removeResult?.ok === true
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
                    removeResult,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "skills-api-confirmed" ? 0 : 1);
    },
);
