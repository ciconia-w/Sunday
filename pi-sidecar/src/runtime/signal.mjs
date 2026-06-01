export class SimpleSignal {
    constructor() {
        this.listeners = new Set();
    }

    connect(listener) {
        this.listeners.add(listener);
    }

    disconnect(listener) {
        this.listeners.delete(listener);
    }

    emit(...args) {
        for (const listener of this.listeners) {
            listener(...args);
        }
    }
}

