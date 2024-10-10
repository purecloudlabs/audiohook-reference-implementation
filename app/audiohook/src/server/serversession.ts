import { Logger } from '../utils/logger';
import StreamDuration from '../utils/streamduration';
import { MaybePromise } from '../utils/promise';
import {
    Uuid,
    ServerMessage,
    ClientMessage,
    MediaParameter,
    MediaParameters,
    OpenParameters,
    DiscardedParameters,
    DisconnectReason,
    EventEntities,
    ResumedParameters,
    CloseParameters,
    LanguageCode,
    UpdateParameters,
    ErrorParameters
} from '../protocol/message';
import { MediaDataFrame } from './mediadata';

export type ServerSessionState =
    | 'PREPARING'
    | 'OPENING'
    | 'ACTIVE'
    | 'PAUSED'
    | 'CLOSING'
    | 'CLOSED'
    | 'SIGNALED-ERROR'
    | 'UNAUTHORIZED'
    | 'FINALIZING'
    | 'DISCONNECTED';


export interface OpenTransactionContext {
    session: ServerSession;
    readonly openParams: OpenParameters;
    readonly selectedMedia: MediaParameter | null;
    setStartPaused(value: boolean): void;
    setDiscardTo(value: StreamDuration): void;
}

export type Authenticator = (session: ServerSession, openParams: OpenParameters) => MaybePromise<void | boolean | string>;

export type MediaSelector = (session: ServerSession, offered: MediaParameters, openParams: OpenParameters) => MaybePromise<MediaParameters>;

export type OpenHandler = (context: OpenTransactionContext) => MaybePromise<CloseHandler | void>;

export type UpdateHandler = (session: ServerSession, updateParams: UpdateParameters | null) => MaybePromise<void>;

export type CloseHandler = (session: ServerSession, closeParams: CloseParameters | null) => MaybePromise<FiniHandler | void>;

export type FiniHandler = (session: ServerSession) => MaybePromise<void>;

export type StatisticsInfo = {
    rtt: StreamDuration;
    // TODO: Add more
};

export type OnPausedHandler         = (this: ServerSession) => void;
export type OnResumedHandler        = (this: ServerSession, parameter: ResumedParameters) => void;
export type OnAudioHandler          = (this: ServerSession, frame: MediaDataFrame) => void;
export type OnDiscardedHandler      = (this: ServerSession, parameter: DiscardedParameters) => void;
export type OnUpdateHandler         = (this: ServerSession, parameter: UpdateParameters) => void;
export type OnErrorHandler          = (this: ServerSession, error: ErrorParameters) => void;
export type OnStatisticsHandler     = (this: ServerSession, info: StatisticsInfo) => void;
export type OnServerMessageHandler  = (this: ServerSession, message: ServerMessage) => void;
export type OnClientMessageHandler  = (this: ServerSession, message: ClientMessage) => void;

export interface ServerSession {
    readonly id: Uuid;
    readonly logger: Logger;
    readonly selectedMedia: Readonly<MediaParameter> | null;
    readonly language?: LanguageCode | null;
    readonly state: ServerSessionState;
    readonly position: StreamDuration;

    pause(): void;

    resume(): void;

    disconnect(reason: DisconnectReason, info?: string): void;
    disconnect(error: Error): void;

    sendEvent(entities: EventEntities): boolean;

    addAuthenticator(handler: Authenticator): this;
    addMediaSelector(handler: MediaSelector): this;
    addOpenHandler(handler: OpenHandler): this;
    addUpdateHandler(handler: UpdateHandler): this;
    addCloseHandler(handler: CloseHandler): this;
    addFiniHandler(handler: FiniHandler): this;

    on(event: 'paused', listener: OnPausedHandler): this;
    on(event: 'resumed', listener: OnResumedHandler): this;
    on(event: 'audio', listener: OnAudioHandler): this;
    on(event: 'discarded', listener: OnDiscardedHandler): this;
    on(event: 'update', listener: OnUpdateHandler): this;
    on(event: 'error', listener: OnErrorHandler): this;
    on(event: 'statistics', listener: OnStatisticsHandler): this;
    on(event: 'serverMessage', listener: OnServerMessageHandler): this;
    on(event: 'clientMessage', listener: OnClientMessageHandler): this;

    off(event: 'paused', listener: OnPausedHandler): this;
    off(event: 'resumed', listener: OnResumedHandler): this;
    off(event: 'audio', listener: OnAudioHandler): this;
    off(event: 'discarded', listener: OnDiscardedHandler): this;
    off(event: 'update', listener: OnUpdateHandler): this;
    off(event: 'error', listener: OnErrorHandler): this;
    off(event: 'statistics', listener: OnStatisticsHandler): this;
    off(event: 'serverMessage', listener: OnServerMessageHandler): this;
    off(event: 'clientMessage', listener: OnClientMessageHandler): this;

    once(event: 'paused', listener: OnPausedHandler): this;
    once(event: 'resumed', listener: OnResumedHandler): this;
    once(event: 'audio', listener: OnAudioHandler): this;
    once(event: 'discarded', listener: OnDiscardedHandler): this;
    once(event: 'update', listener: OnUpdateHandler): this;
    once(event: 'error', listener: OnErrorHandler): this;
    once(event: 'statistics', listener: OnStatisticsHandler): this;
    once(event: 'serverMessage', listener: OnServerMessageHandler): this;
    once(event: 'clientMessage', listener: OnClientMessageHandler): this;
}
