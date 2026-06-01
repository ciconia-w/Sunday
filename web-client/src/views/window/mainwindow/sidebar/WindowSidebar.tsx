import { computed, defineComponent } from "vue";
import { useBackendStore, useConversationManagerStore, useHistoryConversationStore, useMainWindowStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import { ConversationStatus } from "@/types/conversation";
import { createDefaultConversation } from "@/utils/mainwindow/conversationActions";
import BaseItem from "@/views/window/mainwindow/sidebar/components/BaseItem";
import sundayLogo from "@/assets/sunday-brand-logo.png";
import "@/assets/styles/window/mainwindow/sidebar/WindowSidebar.css";

export default defineComponent({
    name: "WindowSidebar",
    components: { BaseItem },
    setup() {
        const b = useBackendStore();
        const m = useMainWindowStore();
        const cm = useConversationManagerStore();
        const hc = useHistoryConversationStore();

        return {
            c: computed(() => m.isSidebarCollapsed),
            toggle: () => m.toggleSidebarCollapse(),
            sundayLogo,
            newChatItem: computed(() => ({ id: "nc", type: "new-conversation", name: b.translate("新建对话"), icon: "icon_new_chat_v2", data: null })),
            wsItems: computed(() => [
                { id: MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS, type: "workspace", icon: "icon_extensions_v2", name: b.translate("扩展"), selected: m.workspacePage === MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS, data: { workspacePage: MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS } },
                { id: "automation", type: "workspace", icon: "icon_automation_v2", name: b.translate("自动化"), selected: m.workspacePage === "automation", data: { workspacePage: "automation" } },
            ]),
            convoItems: computed(() => cm.getConversationIndexListWithStatus.map((x: any) => ({ id: x.id, type: "conversation", icon: "icon_conversation_list", name: String(x.title ?? "").trim() || b.translate("新对话"), selected: m.workspacePage === MAIN_WINDOW_WORKSPACE_PAGES.CHAT && cm.getCurrentConversationId === x.id, right: x.conversationStatus === ConversationStatus.Generating ? b.translate("进行中") : "", data: x }))),
            settingsItem: computed(() => ({ id: MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME, type: "workspace", icon: "icon_settings_v2", name: b.translate("设置"), selected: m.workspacePage === MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME, data: { workspacePage: MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME } })),
            convoTitle: b.translate("对话列表"), historyLink: b.translate("全部历史"), emptyText: b.translate("还没有历史对话"),
            newChat: async () => { await createDefaultConversation(); if (m.workspacePage !== MAIN_WINDOW_WORKSPACE_PAGES.CHAT) await m.openChatPage(); },
            goPage: (p: string) => m.openWorkspacePage(p),
            goConvo: async (id: string) => { await cm.switchConversation(id); if (m.workspacePage !== MAIN_WINDOW_WORKSPACE_PAGES.CHAT) await m.openChatPage(); },
            goHistory: async () => { hc.setOpenedMenuId(null); await m.openHistoryConversationPage(); },
        };
    },
    render() {
        // Collapsed: fixed button at window left edge
        if (this.c) {
            return <button type="button" class="sbar-expand" onClick={this.toggle}>→</button>;
        }
        // Expanded: full sidebar
        return (
            <div class="wsb">
                <button type="button" class="sbar-collapse" onClick={this.toggle}>←</button>
                <div class="wsb-body">
                    <div class="wsb-brand">
                        <img src={this.sundayLogo} width="28" height="28" style="border-radius:6px" alt="Sunday" />
                        <div><div class="wsb-brand-name">Sunday</div><div class="wsb-brand-tag">桑迪接管工作，天天都是周末</div></div>
                    </div>
                    <div class="wsb-newchat"><BaseItem item={this.newChatItem} onClick={this.newChat} /></div>
                    <div class="wsb-nav">{this.wsItems.map((x: any) => <BaseItem key={x.id} item={x} onClick={() => this.goPage(x.data.workspacePage)} />)}</div>
                    <div class="wsb-convos">
                        <div class="wsb-convos-h"><span>{this.convoTitle}</span><button type="button" onClick={this.goHistory}>{this.historyLink}</button></div>
                        {this.convoItems.length ? <div class="wsb-convos-l">{this.convoItems.map((x: any) => <BaseItem key={x.id} item={x} onClick={() => this.goConvo(x.id)} />)}</div> : <div class="wsb-convos-e">{this.emptyText}</div>}
                    </div>
                    <div class="wsb-foot"><BaseItem item={this.settingsItem} onClick={() => this.goPage(this.settingsItem.data.workspacePage)} /></div>
                </div>
            </div>
        );
    },
});
