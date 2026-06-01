import { computed, defineComponent, onMounted, ref } from "vue";
import CommonButton from "@/components/CommonButton";
import { useBackendStore } from "@/stores";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

export default defineComponent({
    name: "BrowserPanelPage",
    setup() {
        const backend = useBackendStore();
        const state = ref({ url: "", title: "", interactive: 0, session: "sunday" });
        const busy = ref(false);
        const statusText = ref("检测中...");

        const checkStatus = async () => {
            busy.value = true;
            try {
                const raw = (await backend.requestSystem("runCliCommand", "opencli daemon status 2>/dev/null | grep -E 'Daemon:|Extension:' | tr '\\n' ' ' || echo 'not-running'")) as string;
                statusText.value = raw.includes("running") && raw.includes("connected") 
                    ? "OpenCLI 已连接" : raw.includes("running") ? "插件未连接" : "守护进程未运行";
                const st = (await backend.requestSystem("runCliCommand", "opencli browser sunday state 2>/dev/null || echo '{}'")) as string;
                try {
                    const d = JSON.parse(st);
                    if (d.data) {
                        const lines = d.data.split("\n");
                        state.value.url = (lines.find((l: string) => l.startsWith("url:")) || "").replace("url: ", "");
                        state.value.title = (lines.find((l: string) => l.startsWith("title:")) || "").replace("title: ", "");
                        state.value.interactive = parseInt((lines.find((l: string) => l.startsWith("interactive:")) || "0").replace("interactive: ", "")) || 0;
                        state.value.session = d.session || "sunday";
                    }
                } catch { /* parse fail */ }
            } catch { statusText.value = "检查失败"; }
            finally { busy.value = false; }
        };

        onMounted(() => { setTimeout(checkStatus, 500); });

        const openUrl = async (url: string) => {
            await backend.requestSystem("runCliCommand", `opencli browser sunday open ${url} 2>/dev/null; echo done`);
            setTimeout(checkStatus, 1500);
        };

        return { state, busy, statusText, checkStatus, openUrl,
            titleText: computed(() => "浏览器"),
            subtitleText: computed(() => "通过 OpenCLI 控制 Chrome 浏览器。") };
    },
    render() {
        return (
            <div class="skills-page">
                <div class="skills-page__header-container"><div class="skills-page__container">
                    <div class="skills-page__header">
                        <div class="skills-page__header-left"><div class="skills-page__header-content">
                            <div class="skills-page__title">{this.titleText}</div>
                            <div class="skills-page__subtitle">{this.subtitleText}</div>
                        </div></div>
                        <div class="skills-page__actions">
                            <CommonButton text={this.busy ? "检查中..." : "刷新"} variant="primary" onClick={this.checkStatus} />
                        </div>
                    </div>
                </div></div>
                <div class="skills-page__content" style="overflow-y:auto">
                    <div class="skills-page__content-container"><div class="skills-page__container">
                        <div style="margin-bottom:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                            <div style="font-size:14px;font-weight:600;margin-bottom:4px">会话状态</div>
                            <div style="font-size:12px;color:var(--text-tertiary,#999)">{this.statusText}</div>
                            <div style="margin-top:8px;font-size:12px">
                                URL: {this.state.url || "无"}<br/>标题: {this.state.title || "无"}<br/>可交互: {this.state.interactive} 个元素
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            <CommonButton text="打开 Example" variant="default" onClick={() => this.openUrl("https://example.com")} />
                            <CommonButton text="打开百度" variant="default" onClick={() => this.openUrl("https://www.baidu.com")} />
                            <CommonButton text="打开 GitHub" variant="default" onClick={() => this.openUrl("https://github.com")} />
                        </div>
                    </div></div>
                </div>
            </div>
        );
    },
});
