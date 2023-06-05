
export interface LeveledLogMethod {
    (msg: string): void;
}

export interface Logger {
    fatal: LeveledLogMethod;
    error: LeveledLogMethod;
    warn: LeveledLogMethod;
    info: LeveledLogMethod;
    debug: LeveledLogMethod;
    trace: LeveledLogMethod;   
}

