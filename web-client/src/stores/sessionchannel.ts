import { SessionEvent } from "@/types/message";
import { useConversationManagerStore } from "@/stores/conversationmanager";
import { useDebugEventsStore } from "@/stores/debugEvents";
import { defineStore } from "pinia";
import { nextTick } from "vue";

export const useSessionChannelStore = defineStore("sessionChannel", {
    state: () => ({}),

    getters: {},

    actions: {
        // 初始化 sessionChannel 监听器
        initializeSessionChannel(sessionChannel: any) {
            if (!sessionChannel) {
                console.warn("Session channel is not available");
                return;
            }

            const conversationManagerStore = useConversationManagerStore();

            // 流式渲染队列：避免批量事件被 Vue 一次渲染
            const streamQueue: Array<{event: SessionEvent; sessionId: string; message: string; conversationId: string}> = [];
            let streamQueueRunning = false;

            const flushStreamQueue = async () => {
                if (!performance.getEntriesByName("sunday-first-event").length) { performance.mark("sunday-first-event"); }
                if (streamQueue.length === 0) {
                    streamQueueRunning = false;
                    return;
                }
                streamQueueRunning = true;
                const item = streamQueue.shift()!;
                this.handleSessionEvent(item.event, item.sessionId, item.message, item.conversationId, conversationManagerStore);
                // 强制 Vue flush DOM 后再处理下一个事件
                await nextTick();
                if (performance.getEntriesByName("sunday-first-text").length && !performance.getEntriesByName("sunday-first-paint").length) { performance.mark("sunday-first-paint"); }
                setTimeout(() => flushStreamQueue(), 0);
            };

            // 监听 sessionEvent
            sessionChannel.sessionEvent.connect((event: SessionEvent, sessionId: string, message: string) => {
                // Session event log moved to debugEvents store
                useDebugEventsStore().pushSessionEvent(event, sessionId, message);
                let parsedConversationId = "";
                if (message) {
                    try {
                        const parsed = JSON.parse(message) as { conversation_id?: string };
                        const conversationId = parsed.conversation_id;
                        parsedConversationId = conversationId || "";
                        if (conversationId && !conversationManagerStore.answeringSession.get(sessionId)) {
                            conversationManagerStore.answeringSession.set(sessionId, conversationId);
                        }
                    } catch {
                        // noop
                    }
                }
                const body = document.body;
                if (body) {
                    const currentCount = Number(body.getAttribute("data-session-event-count") || "0");
                    body.setAttribute("data-session-event-count", String(currentCount + 1));
                    body.setAttribute("data-session-last-event", String(event));
                    body.setAttribute("data-session-last-id", sessionId);
                    body.setAttribute(
                        "data-session-last-message",
                        encodeURIComponent((message || "").slice(0, 500)),
                    );
                    if (message) {
                        try {
                            const parsed = JSON.parse(message) as { type?: string };
                            if (parsed.type) {
                                body.setAttribute("data-session-last-message-type", parsed.type);
                            }
                        } catch {
                            // noop
                        }
                    }
                }
                // 推入流式队列而非同步处理
                streamQueue.push({ event, sessionId, message, conversationId: parsedConversationId });
                if (!streamQueueRunning) flushStreamQueue();
            });
        },

        // 处理会话事件，调用conversationManagerStore中的方法
        handleSessionEvent(
            event: SessionEvent,
            sessionId: string,
            message: string,
            conversationId: string,
            conversationManagerStore: any,
        ) {
            // 处理会话开始事件
            if (event === SessionEvent.SeStarted) {
                conversationManagerStore.handleSessionStarted(sessionId, conversationId);
                return;
            }

            // 处理会话消息事件
            if (event === SessionEvent.SeMessage) {
                conversationManagerStore.handleSessionMessage(sessionId, message, conversationId);
                return;
            }

            // 处理会话完成事件
            if (event === SessionEvent.SeFinished) {
                conversationManagerStore.handleSessionFinished(sessionId, message, conversationId);
                return;
            }

            // 处理会话错误事件
            if (event === SessionEvent.SeError) {
                conversationManagerStore.handleSessionError(sessionId, message, conversationId);
                return;
            }
        },
    },
});
