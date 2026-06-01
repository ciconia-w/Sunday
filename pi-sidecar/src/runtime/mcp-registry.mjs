export class McpRegistry {
    constructor() {
        this.thirdPartyAgreementAccepted = false;
        this.services = [
            {
                id: "filesystem",
                name: "Filesystem",
                description: "Local filesystem access for the agent runtime.",
                category: "systemBuiltIn",
                enabled: true,
                isBuiltIn: true,
                editable: false,
                removable: false,
            },
        ];
    }

    getServicesResponse() {
        return {
            success: true,
            services: this.services,
            runtimeReady: true,
            thirdPartyAgreementAccepted: this.thirdPartyAgreementAccepted,
        };
    }

    isRuntimeReady() {
        return true;
    }

    getThirdPartyAgreement() {
        return this.thirdPartyAgreementAccepted;
    }

    setThirdPartyAgreement(accepted) {
        this.thirdPartyAgreementAccepted = accepted === true;
        return true;
    }
}
