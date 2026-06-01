export type SignalListener<TArgs extends unknown[]> = (...args: TArgs) => void;

export interface SignalLike<TArgs extends unknown[]> {
    connect(listener: SignalListener<TArgs>): void;
    disconnect(listener: SignalListener<TArgs>): void;
}

export class SimpleSignal<TArgs extends unknown[]> implements SignalLike<TArgs> {
    private readonly listeners = new Set<SignalListener<TArgs>>();

    connect(listener: SignalListener<TArgs>): void {
        this.listeners.add(listener);
    }

    disconnect(listener: SignalListener<TArgs>): void {
        this.listeners.delete(listener);
    }

    emit(...args: TArgs): void {
        for (const listener of this.listeners) {
            listener(...args);
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}

