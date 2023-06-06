
export type TimerHandler = () => void;

export interface TimerSubscription {
    cancel(): void;
}

export interface TimeProvider {
    startTimeout(handler: TimerHandler, timeout: number): TimerSubscription;
    startInterval(handler: TimerHandler, interval: number): TimerSubscription;
    getHighresTimestamp(): bigint;
}

export const defaultTimeProvider: TimeProvider = {
    startTimeout: (handler: TimerHandler, timeout: number) => {
        const timer = setTimeout(handler, timeout);
        return { cancel: () => clearTimeout(timer) };
    },

    startInterval: (handler: TimerHandler, interval: number) => {
        const timer = setInterval(handler, interval);
        return { cancel: () => clearTimeout(timer) };
    },

    getHighresTimestamp: () => (
        process.hrtime.bigint()
    )
};

