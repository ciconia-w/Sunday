/**
 * 用法：
 *
 * 1. 把这个文件复制到 `uos-ai preview3 web/src/views/root/initializePiMode.ts`
 * 2. 在 `Root.vue` 中改成：
 *    import initialize from "./initializePiMode";
 * 3. 在宿主里给 `window.__UOS_PI_CHANNELS__` 注入 channel 对象
 */

import { useRouter } from "vue-router";
import { useBackendStore } from "@/stores";
import { useReportChannelStore } from "@/stores/reportchannel";
import { updateActiveColor, updateFont, updateThemeColor } from "@/utils/themeAppearance";

const initialize = async function () {
    const router = useRouter();
    const backendStore = useBackendStore();
    const reportChannelStore = useReportChannelStore();
    const channels = window.__UOS_PI_CHANNELS__;

    if (!channels) {
        throw new Error("window.__UOS_PI_CHANNELS__ is missing");
    }

    router.replace({ name: "App" });
    document.body.setAttribute("data-runtime-bootstrap", "connected");
    backendStore.setSessionChannel(channels.sessObj as never);
    backendStore.setWindowChannel(channels.windowObj as never);
    backendStore.setAssistantChannel(channels.assistObj as never);
    backendStore.setSystemChannel(channels.systemObj as never);
    backendStore.setServiceConfigChannel(channels.serviceConfigObj as never);
    backendStore.setConversationChannel(channels.conversationObj as never);
    backendStore.setFileChannel(channels.fileObj as never);
    backendStore.setAudioChannel(channels.audioObj as never);
    backendStore.setTaskChannel(channels.taskObj as never);
    backendStore.setSkillsMgr(channels.skillsMgr as never);
    backendStore.setReportChannel(channels.reportObj as never);
    reportChannelStore.initializeReportChannel(channels.reportObj as never);

    const systemObj = channels.systemObj;
    if (systemObj) {
        if (systemObj.activeColor) {
            updateActiveColor(systemObj.activeColor);
        }
        systemObj.activeColorChanged.connect((color: string) => {
            updateActiveColor(color);
        });

        updateFont(await systemObj.fontInfo);
        updateThemeColor(await systemObj.themeColor);

        systemObj.themeColorChanged.connect((themeColor: number) => {
            updateThemeColor(themeColor);
        });

        systemObj.themeIconChanged.connect(() => {
            backendStore.bumpThemeIconVersion();
        });
    }

    const windowObj = channels.windowObj;
    if (windowObj) {
        windowObj.windowFontChanged.connect((fontInfo: string) => {
            updateFont(fontInfo);
        });
    }

    document.body.setAttribute("data-runtime-route", "app");
};

export default initialize;
