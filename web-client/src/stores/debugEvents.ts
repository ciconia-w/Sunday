import { defineStore } from "pinia";

export interface SessionDebugEvent {
    event: number;
    sessionId: string;
    message: string;
    timestamp: number;
}

export const useDebugEventsStore = defineStore("debugEvents", {
    state: () => ({
        sessionEvents: [] as SessionDebugEvent[],
    }),

    actions: {
        pushSessionEvent(event: number, sessionId: string, message: string) {
            this.sessionEvents.unshift({
                event,
                sessionId,
                message,
                timestamp: Date.now(),
            });
            if (this.sessionEvents.length > 10) {
                this.sessionEvents.length = 10;
            }
        },
    },
});

