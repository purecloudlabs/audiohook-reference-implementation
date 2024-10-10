import {
    EventParameters,
    Uuid,
    OpenedMessage,
    ClosedMessage,
    PausedMessage,
    PingMessage,
    PongMessage
} from '../protocol/message';
import {
    EventEntityDataTranscript
} from '../protocol/entities-transcript'
import {
    Duration,
    LanguageCode,
} from '../protocol/core'

export type ClientSessionState = 
    | 'CONNECTING'
    | 'PREPARING'
    | 'OPENING'
    | 'OPEN'
    | 'CLOSING'
    | 'CLOSING-ERROR'
    | 'CLOSED'
    | 'DISCONNECTED';

export type OnDisconnectedHandler = (this: ClientSession) => void;
export type OnEventHandler = (this: ClientSession, parameters: EventParameters) => void;
export type OnRttInfoHandler = (this: ClientSession, rtt: number) => void;

export interface ClientSession {
    readonly id: Uuid;
    readonly organizationId: Uuid;
    readonly state: ClientSessionState;
    readonly openedMsg: OpenedMessage | undefined;
    readonly closedMsg: ClosedMessage | undefined;
    readonly pausedMsg: PausedMessage | undefined;
    readonly pingMsg: PingMessage | undefined;
    readonly pongMsg: PongMessage | undefined;
    seq: number;
    serverseq: number;
    transcripts: EventEntityDataTranscript[];

    close(): Promise<void>;
    pinging(): Promise<void>;
    erroring(): Promise<void>;
    updating(new_lang: string): Promise<void>;
    pausing(): Promise<void>;
    resuming(start: Duration, discarded: Duration): Promise<void>;
    discarding(startTime: Duration, durationTime: Duration): Promise<void>;

    on(event: 'disconnected', listener: OnDisconnectedHandler): this;
    on(event: 'event', listener: OnEventHandler): this;
    on(event: 'rttInfo', listener: OnRttInfoHandler): this;

    off(event: 'disconnected', listener: OnDisconnectedHandler): this;
    off(event: 'event', listener: OnEventHandler): this;
    off(event: 'rttInfo', listener: OnRttInfoHandler): this;

    once(event: 'disconnected', listener: OnDisconnectedHandler): this;
    once(event: 'event', listener: OnEventHandler): this;
    once(event: 'rttInfo', listener: OnRttInfoHandler): this;
}
