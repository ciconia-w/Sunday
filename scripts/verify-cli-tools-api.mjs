import { execFile } from "node:child_process";
import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

function runShell(command) {
    return new Promise((resolve) => {
        execFile("/bin/bash", ["-lc", command], { timeout: 15000, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
            resolve({
                ok: !error,
                stdout: String(stdout || ""),
                stderr: String(stderr || ""),
            });
        });
    });
}

function parseJson(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

async function commandExists(commandName) {
    const result = await runShell(`command -v ${commandName} >/dev/null 2>&1 && echo yes || echo no`);
    return result.stdout.trim() === "yes";
}

function inferGithubStatus(commandExistsResult, authJson) {
    if (!commandExistsResult) {
        return "not_installed";
    }
    const hosts = authJson?.hosts && typeof authJson.hosts === "object" ? Object.values(authJson.hosts).flat() : [];
    const activeHost = hosts.find((host) => host?.active === true && host?.state === "success");
    return activeHost ? "authorized" : "needs_auth";
}

function inferOpenCliStatus(commandExistsResult, daemonStatusText) {
    if (!commandExistsResult) {
        return "not_installed";
    }
    const text = String(daemonStatusText || "");
    const daemonRunning = /Daemon:\s*running/i.test(text);
    const extensionConnected = /Extension:\s*connected/i.test(text);
    if (daemonRunning && extensionConnected) {
        return "available";
    }
    if (daemonRunning) {
        return "extension_disconnected";
    }
    return "daemon_stopped";
}

function inferLarkStatus(commandExistsResult, authJson) {
    if (!commandExistsResult) {
        return "not_installed";
    }
    const tokenStatus = String(authJson?.tokenStatus || "").trim();
    if (tokenStatus === "ok") {
        return "authorized";
    }
    if (tokenStatus === "expired" || tokenStatus === "needs_refresh") {
        return "expired";
    }
    return "needs_auth";
}

function extractVersion(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return "";
    }

    const versionMatch = trimmed.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
    if (versionMatch) {
        return versionMatch[0];
    }

    return trimmed.split(/\s+/)[0] || "";
}

function compareVersions(left, right) {
    const normalizeParts = (value) => extractVersion(value)
        .replace(/^v/i, "")
        .split(/[.+-]/)
        .map((part) => Number.parseInt(part, 10))
        .map((part) => (Number.isFinite(part) ? part : 0));

    const leftParts = normalizeParts(left);
    const rightParts = normalizeParts(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;
        if (leftPart > rightPart) {
            return 1;
        }
        if (leftPart < rightPart) {
            return -1;
        }
    }

    return 0;
}

await withSidecarRuntime(
    {
        sidecarPort: 8809,
    },
    async ({ sidecarPort }) => {
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const endpointResult = await post(baseUrl, "/service-config/get-cli-tools-state", {});
        const endpointItems = Array.isArray(endpointResult?.result) ? endpointResult.result : [];
        const byId = Object.fromEntries(endpointItems.map((item) => [item.id, item]));

        const ghInstalled = await commandExists("gh");
        const opencliInstalled = await commandExists("opencli");
        const larkInstalled = await commandExists("lark-cli");

        const ghAuth = parseJson((await runShell("gh auth status --json hosts 2>/dev/null || echo '{}'")).stdout);
        const opencliStatus = (await runShell("opencli daemon status 2>/dev/null || true")).stdout;
        const larkAuth = parseJson((await runShell("lark-cli auth status 2>/dev/null || echo '{}'")).stdout);

        const expected = {
            "gh-cli": inferGithubStatus(ghInstalled, ghAuth),
            opencli: inferOpenCliStatus(opencliInstalled, opencliStatus),
            "lark-cli": inferLarkStatus(larkInstalled, larkAuth),
        };

        const matches = Object.fromEntries(
            Object.entries(expected).map(([id, token]) => [id, byId[id]?.statusToken === token]),
        );
        const metadataChecks = Object.fromEntries(
            endpointItems.map((item) => [
                item.id,
                typeof item?.detailText === "string" &&
                    item.detailText.length > 0 &&
                    typeof item?.actionText === "string" &&
                    typeof item?.actionDisabled === "boolean" &&
                    typeof item?.actionKind === "string" &&
                    typeof item?.actionPayload === "string" &&
                    typeof item?.latestVersion === "string" &&
                    typeof item?.updateAvailable === "boolean",
            ]),
        );
        const updateMetadataChecks = Object.fromEntries(
            endpointItems.map((item) => {
                const currentVersion = extractVersion(item?.detailText);
                const latestVersion = extractVersion(item?.latestVersion);
                const shouldUpdate = currentVersion && latestVersion
                    ? compareVersions(currentVersion, latestVersion) < 0
                    : false;
                return [
                    item.id,
                    shouldUpdate ? item?.updateAvailable === true : true,
                ];
            }),
        );

        const verdict =
            endpointResult?.ok === true &&
            endpointItems.length === 3 &&
            Object.values(matches).every(Boolean) &&
            Object.values(metadataChecks).every(Boolean) &&
            Object.values(updateMetadataChecks).every(Boolean)
                ? "cli-tools-api-confirmed"
                : "cli-tools-api-incomplete";

        console.log(
            JSON.stringify(
                {
                    sidecarPort,
                    endpointItems,
                    expected,
                    matches,
                    metadataChecks,
                    updateMetadataChecks,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "cli-tools-api-confirmed" ? 0 : 1);
    },
);
