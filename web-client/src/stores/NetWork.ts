import { defineStore } from "pinia";

export type NetworkStatus = "online" | "offline" | "unknown";

export interface NetworkState {
    status: NetworkStatus;
}

export const useNetworkStore = defineStore("network", {
    state: (): NetworkState => ({
        status: "unknown",
    }),

    getters: {
        isNetworkOnline: (state) => state.status === "online",
    },

    actions: {
        setStatus(status: NetworkStatus) {
            this.status = status;
        },

        // 重置网络状态
        reset() {
            this.status = "unknown";
        },

        // initialize network status to unknown
        async initNetworkStatus(systemChannel: any) {
            this.reset();
            // 连接后端网络状态检测信号
            if (!systemChannel || !systemChannel.networkChanged) {
                return;
            }

            // 初始化网络状态
            const isAvailable = await systemChannel.networkStatus;
            this.setStatus(isAvailable ? "online" : "offline");

            systemChannel.networkChanged.connect((isOnline: boolean) => {
                this.setStatus(isOnline ? "online" : "offline");
            });
        },
    },
});
