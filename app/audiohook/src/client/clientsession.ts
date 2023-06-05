import {
    EventParameters,
    Uuid,
} from '../protocol/message';

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

    close(): Promise<void>;

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
