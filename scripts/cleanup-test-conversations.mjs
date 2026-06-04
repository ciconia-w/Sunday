import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

await withSidecarRuntime(
    {
        sidecarPort: 8791,
    },
    async ({ sidecarPort }) => {
        const postToRuntime = async (path, body) => {
            const response = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body ?? {}),
            });
            return response.json();
        };

        const response = await postToRuntime("/conversation/indexes", {});
        const indexes = Array.isArray(response?.result) ? response.result : [];

        const shouldDelete = (title) => {
            if (typeof title !== "string") {
                return false;
            }

            return (
                title === "history-check-message" ||
                title.includes("Reply with exactly: qt-live-ok") ||
                (title.includes("Use tools now.") && title.includes("qt-tool-ok"))
            );
        };

        const ids = indexes.filter((item) => shouldDelete(item?.title)).map((item) => item.id).filter(Boolean);

        if (ids.length > 0) {
            await postToRuntime("/conversation/delete", { ids });
        }

        console.log(
            JSON.stringify(
                {
                    count: ids.length,
                    ids,
                    verdict: "test-conversation-cleanup-complete",
                },
                null,
                2,
            ),
        );
    },
);
