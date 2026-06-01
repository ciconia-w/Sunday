export interface DemoApprovalRecord {
    sessionId: string;
    conversationId: string;
    text: string;
    requestId: string;
}

export interface DemoApprovalAction {
    request_id?: string;
    approved?: boolean;
    approve?: boolean;
    reject_msg?: string;
}

export interface DemoApprovalBrokerDeps {
    emitSession: (event: number, sessionId: string, message: string) => void;
    wait: (ms: number) => Promise<unknown>;
}

export class DemoApprovalBroker {
    private readonly pending = new Map<string, DemoApprovalRecord>();
    private readonly deps: DemoApprovalBrokerDeps;

    constructor(deps: DemoApprovalBrokerDeps) {
        this.deps = deps;
    }

    create(sessionId: string, conversationId: string, text: string): string {
        const requestId = crypto.randomUUID();
        this.pending.set(requestId, {
            sessionId,
            conversationId,
            text,
            requestId,
        });
        return requestId;
    }

    emitPendingBashApprove(requestId: string): void {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return;
        }

        this.deps.emitSession(
            4,
            pending.sessionId,
            JSON.stringify({
                type: "interactive_components",
                data: {
                    id: requestId,
                    ic_type: "bash_approve",
                    title: "Allow demo bash command?",
                    command: `echo ${JSON.stringify(pending.text || "(empty)")}`,
                    status: "pending",
                },
            }),
        );
    }

    async apply(action: DemoApprovalAction): Promise<boolean> {
        const requestId = action.request_id ?? "";
        const pending = this.pending.get(requestId);
        if (!pending) {
            return false;
        }
        this.pending.delete(requestId);

        const approved = action.approved === true || action.approve === true;
        this.deps.emitSession(
            4,
            pending.sessionId,
            JSON.stringify({
                type: "interactive_components",
                data: {
                    id: requestId,
                    ic_type: "bash_approve",
                    title: "Allow demo bash command?",
                    command: `echo ${JSON.stringify(pending.text || "(empty)")}`,
                    status: approved ? "approved" : "rejected",
                },
            }),
        );

        await this.deps.wait(80);

        if (approved) {
            this.deps.emitSession(
                4,
                pending.sessionId,
                JSON.stringify({
                    type: "tool",
                    data: { name: "mock_tool", status: 1, result: `processed: ${pending.text}` },
                }),
            );
            await this.deps.wait(80);
            this.deps.emitSession(
                4,
                pending.sessionId,
                JSON.stringify({
                    type: "text",
                    data: { content: `审批已通过，继续执行：${pending.text}` },
                }),
            );
        } else {
            this.deps.emitSession(
                4,
                pending.sessionId,
                JSON.stringify({
                    type: "error",
                    data: {
                        error: 0,
                        error_message: action.reject_msg || "Mock action rejected by user",
                    },
                }),
            );
        }

        await this.deps.wait(80);
        this.deps.emitSession(
            2,
            pending.sessionId,
            JSON.stringify({ id: crypto.randomUUID(), conversation_id: pending.conversationId }),
        );

        return true;
    }
}

