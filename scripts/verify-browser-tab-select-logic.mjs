import { chooseBrowserTabSelectionAction } from "../pi-sidecar/src/runtime/browser-tab-selection.mjs";

const cases = [
    {
        id: "fallback-http-url",
        controlState: { stableTabSwitch: false },
        panelState: {
            url: "",
            tabs: [
                {
                    page: "page-1",
                    url: "https://example.com/docs",
                    active: false,
                },
            ],
        },
        pageId: "page-1",
        expected: {
            mode: "reopen-url",
            fallbackUrl: "https://example.com/docs",
            messageIncludes: "已改为重新打开 https://example.com/docs",
        },
    },
    {
        id: "keep-select-on-about-blank",
        controlState: { stableTabSwitch: false },
        panelState: {
            url: "about:blank",
            tabs: [
                {
                    page: "page-2",
                    url: "about:blank",
                    active: true,
                },
            ],
        },
        pageId: "page-2",
        expected: {
            mode: "select",
            fallbackUrl: "about:blank",
            messageIncludes: "",
        },
    },
    {
        id: "keep-select-when-runtime-stable",
        controlState: { stableTabSwitch: true },
        panelState: {
            url: "https://example.com",
            tabs: [
                {
                    page: "page-3",
                    url: "https://example.com",
                    active: true,
                },
            ],
        },
        pageId: "page-3",
        expected: {
            mode: "select",
            fallbackUrl: "",
            messageIncludes: "",
        },
    },
];

const results = cases.map((item) => {
    const actual = chooseBrowserTabSelectionAction(item.controlState, item.panelState, item.pageId);
    const ok =
        actual.mode === item.expected.mode &&
        actual.fallbackUrl === item.expected.fallbackUrl &&
        (!item.expected.messageIncludes || String(actual.message || "").includes(item.expected.messageIncludes));

    return {
        id: item.id,
        ok,
        actual,
        expected: item.expected,
    };
});

const verdict = results.every((item) => item.ok)
    ? "browser-tab-select-logic-confirmed"
    : "browser-tab-select-logic-incomplete";

console.log(
    JSON.stringify(
        {
            results,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "browser-tab-select-logic-confirmed" ? 0 : 1);
