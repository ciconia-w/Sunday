async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const skillsData = await post("/skills/data", {});
const firstSkill = skillsData.result?.[0] ?? null;

let toggleResult = null;
let hasResult = null;
let removeResult = null;

if (firstSkill?.name) {
    toggleResult = await post("/skills/set-enabled", {
        skillName: firstSkill.name,
        enabled: firstSkill.enabled === true ? false : true,
    });

    hasResult = await post("/skills/has", {
        skillName: firstSkill.name,
    });

    removeResult = await post("/skills/remove", {
        skillName: "__nonexistent_skill__",
    });
}

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
            count: Array.isArray(skillsData.result) ? skillsData.result.length : 0,
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
