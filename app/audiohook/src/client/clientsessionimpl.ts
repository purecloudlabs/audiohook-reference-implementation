/* eslint-disable @typescript-eslint/ban-types */
import { EventEmitter } from 'stream';
import { v4 as uuid } from 'uuid';
import { 
    isPromise,
    Logger,
    MaybePromise,
    normalizeError,
    StreamDuration,
} from '../utils';
import {
    ClientMessage,
    ClientMessageBase,
    ClientMessageType,
    ClosedMessage,
    CloseReason,
    DisconnectMessage,
    ErrorCode,
    EventMessage,
    JsonObject,
    LanguageCode,
    MediaParameter,
    MediaParameters,
    MessageDispatcher,
    OpenedMessage,
    OpenParameters,
    Participant,
    PausedMessage,
    PauseMessage,
    PingMessage,
    PongMessage,
    ReconnectMessage,
    ResumeMessage,
    SelectParametersForType,
    ServerMessage,
    ServerMessageBase,
    UpdatedMessage,
    Uuid,
} from '../protocol/message';
import {
    isServerMessage,
    isServerMessageBase,
} from '../protocol/validators';
import {
    TimeProvider,
    TimerSubscription,
    defaultTimeProvider,
} from '../utils/timeprovider';
import {
    ClientSession,
    OnDisconnectedHandler,
    OnEventHandler,
    OnRttInfoHandler,
    ClientSessionState,
} from './clientsession';
import {
    MediaSource
} from './mediasource';
import {
    EventEntityDataTranscript
} from '../protocol/entities-transcript';
import {
    Duration,
} from '../protocol/core';
import '../protocol/entities-transcript';
 
/**
 * Interface of methods the AudioHook ClientSession implementation requires from the WebSocket connection 
 */
export interface ClientWebSocket {
    readonly readyState: 0 | 1 | 2 | 3;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;    

    close(): void;
    send(data: string | Uint8Array): void;
    on(event: 'open', listener: (this: ClientWebSocket) => void): this;
    on(event: 'close', listener: (this: ClientWebSocket, code: number) => void): this;
    on(event: 'error', listener: (this: ClientWebSocket, err: Error) => void): this;
    on(event: 'message', listener: (this: ClientWebSocket, data: Uint8Array, isBinary: boolean) => void): this;
}


export type AuthInfo = {
    apiKey: string;
    clientSecret: Uint8Array | null;
};


export type ClientWebSocketOptions = {
    uri: string;
    organizationId: string;
    sessionId: string;
    correlationId: string;
    authInfo: AuthInfo;
    logger: Logger;
};

export type ClientWebSocketFactory = (options: ClientWebSocketOptions) => ClientWebSocket;


export type PartialOpenParameters = {
    organizationId: Uuid;
    conversationId?: Uuid;
    participant?: Participant;
    media: MediaParameters;
    customConfig?: JsonObject;
    language?: LanguageCode;
    supportedLanguages?: boolean;
};

export type OpenParameterProvider = (session: ClientSession, openParams: PartialOpenParameters) => MaybePromise<OpenParameters>;

export type ClientSessionOptions = {
    uri: string;
    mediaSource: MediaSource;
    organizationId: Uuid;
    sessionId?: Uuid;
    correlationId?: Uuid;
    conversationId?: Uuid;
    participant?: Participant;
    customConfigParam?: JsonObject;
    languageParam?: LanguageCode;
    supportedLanguages?: boolean;
    createWebSocket: ClientWebSocketFactory;
    openParameterProvider?: OpenParameterProvider;
    authInfo: AuthInfo;
    logger: Logger;
    timeProvider?: TimeProvider;
    openTimeout?: number;
    closeTimeout?: number;
    pingInterval?: number;
    initialPingDelay?: number;
};

export const createClientSession = (options: ClientSessionOptions): ClientSession => {
    return ClientSessionImpl.create(options);
};


const DEFAULT_OPEN_TIMEOUT = 5000;
const DEFAULT_CLOSE_TIMEOUT = 10000;
const DEFAULT_INITIAL_PING_DELAY = 1000;
const DEFAULT_PING_INTERVAL = 5000;

class ClientSessionImpl extends EventEmitter implements ClientSession {
    readonly id: Uuid;
    readonly organizationId: string;
    state: ClientSessionState;
    openedMsg: OpenedMessage | undefined;
    closedMsg: ClosedMessage | undefined;
    pausedMsg: PausedMessage | undefined;
    pingMsg: PingMessage | undefined;
    pongMsg: PongMessage | undefined;
    transcripts: EventEntityDataTranscript[];

    seq = 0;
    serverseq = 0;

    private readonly ws: ClientWebSocket;
    private readonly logger: Logger;
    private readonly messageDispatch: MessageDispatcher<ServerMessage>;
    private readonly options: ClientSessionOptions;
    private readonly timeProvider: TimeProvider;
    private openParameters: OpenParameters | null = null;
    private pingTimerInitial: TimerSubscription | null = null;
    private pingTimerInterval: TimerSubscription | null = null;
    private openTimer: TimerSubscription | null = null;
    private closeTimer: TimerSubscription | null = null;
    private closeFinal: Array<{ resolve: () => void, reject: (error: Error) => void }> = [];
    private mediaSource: MediaSource;
    private pendingPing: { timestamp: bigint, seq: number } | null = null;
    private lastPingPongTime: bigint | null = null;

    constructor(options: ClientSessionOptions) {
        super();
        this.options = { ...options };
        this.id = options.sessionId ?? uuid();
        this.logger = options.logger;
        this.organizationId = options.organizationId;
        this.mediaSource = options.mediaSource;
        this.timeProvider = options.timeProvider ?? defaultTimeProvider;
        this.state = 'CONNECTING';
        this.openedMsg = undefined;
        this.closedMsg = undefined;
        this.pingMsg = undefined;
        this.pongMsg = undefined;
        this.transcripts = [];
        const ws = this.options.createWebSocket({
            uri: options.uri,
            organizationId: this.organizationId,
            sessionId: this.id,
            correlationId: this.options.correlationId ?? uuid(),
            authInfo: options.authInfo,
            logger: this.logger,
        });
        if(ws.readyState !== ws.CONNECTING) {
            throw new Error(`WebSocket in state ${ws.readyState}, not in state ${ws.CONNECTING} (CONNECTING)`);
        }

        this.ws = ws;
        this.registerHandlers();
        this.messageDispatch = {
            closed: msg => this.onClosedMessage(msg),
            disconnect: msg => this.onDisconnectMessage(msg),
            event: msg => this.onEventMessage(msg),
            opened: msg => this.onOpenedMessage(msg),
            pong: msg => this.onPongMessage(msg),
            pause: msg => this.onPauseMessage(msg),
            reconnect: msg => this.onReconnectMessage(msg),
            resume: msg => this.onResumeMessage(msg),
            updated: msg => this.onUpdatedMessage(msg),
        } as const;
    }

    static create(options: ClientSessionOptions): ClientSession {
        return new ClientSessionImpl(options);
    }

    registerHandlers(): void {
        this.ws.on('open', () => this.onWsOpen());
        this.ws.on('close', (code: number) => this.onWsClose(code));
        this.ws.on('message', (data, isBinary): void => {
            try {
                if (isBinary) {
                    this.onBinaryMessage(data);
                } else {
                    this.onTextMessage(Buffer.from(data).toString('utf8'));
                }
            } catch (err) {
                this.logger.error(`Error processing message: ${normalizeError(err).stack}`);
                this.signalFatalError(500, 'Internal client error');
            }
        });
        this.ws.on('error', (error: Error) => {
            this.logger.error(`Websocket error, forcing close: ${error.stack}`);
            this.ws.close();
        });

        this.mediaSource.on('audio', (data) => {
            if(this.state === 'OPEN') {
                this.ws.send(data);
            }
        });
        this.mediaSource.on('discarded', (start, discarded) => {
            if(this.state === 'OPEN') {
                this.sendMessage(this.buildMessage('discarded', { start: start.asDuration(), discarded: discarded.asDuration() }));
            }
        });
        this.mediaSource.on('paused', () => {
            if(this.state === 'OPEN') {
                this.sendMessage(this.buildMessage('paused', {}));
            }
        });
        this.mediaSource.on('resumed', (start, discarded) => {
            if(this.state === 'OPEN') {
                this.sendMessage(this.buildMessage('resumed', { start: start.asDuration(), discarded: discarded.asDuration() }));
            }
        });
        this.mediaSource.on('end', (duration) => {
            this.logger.info(`Source stream ended (duration: ${duration}), closing session.`);
            this.initiateClose('end'); 
        });
        this.mediaSource.on('error', (error) => {
            this.logger.error(`Media source signaled error: ${error.stack}`);
            this.signalFatalError(500, 'Internal client error');
        });
    }

    close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === 'DISCONNECTED') {
                resolve();
            } else {
                this.closeFinal.push({ resolve, reject });
                this.initiateClose('end');
            }
        });
    }

    pinging(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendPing();
            resolve();
        });
    }

    erroring(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendErrorMessage(400, 'tough stuff');
            resolve();
        });
    }

    updating(new_lang: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendUpdateMessage(new_lang);
            resolve();
        });
    }

    discarding(startTime: Duration, durationTime: Duration): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendMessage(this.buildMessage('discarded', { start: startTime, discarded: durationTime }));
            resolve();
        });
    }

    pausing(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.mediaSource.pause();
            const toSend = this.buildMessage('paused', {});
            this.sendMessage(toSend);
            this.pausedMsg = toSend;
            resolve();
        });
    }

    resuming(start: Duration, discarded: Duration): Promise<void> {
        return new Promise((resolve, reject) => {
            this.mediaSource.resume();
            resolve();
        });
    }

    private initiateClose(reason: CloseReason) {
        if (!this.isClosing && (this.state !== 'CLOSED') && (this.state !== 'DISCONNECTED')) {
            this.state = reason === 'error' ? 'CLOSING-ERROR' : 'CLOSING';
            this.mediaSource.close();
            this.stopPingTimer();
            this.openTimer = this.openTimer?.cancel() ?? null;
            if(this.ws.readyState !== this.ws.OPEN) {
                this.logger.warn(`WebSocket is in readyState ${this.ws.readyState}, cannot execute close transaction`);
                this.initiateDisconnect();
            } else {
                this.closeTimer = this.timeProvider.startTimeout(() => {
                    this.closeTimer = null;
                    if(this.isClosing) {
                        this.logger.warn(`Timeout waiting for close transaction to complete in state ${this.state}`);
                        this.sendErrorMessage(408, 'Close transaction timeout');
                        this.initiateDisconnect();
                    }
                }, this.options.closeTimeout ?? DEFAULT_CLOSE_TIMEOUT);
                this.sendMessage(this.buildMessage('close', { reason }));
            }
        }
    }

    private initiateDisconnect(): void {
        if((this.state !== 'CLOSED') && (this.state !== 'DISCONNECTED')) {
            this.state = 'CLOSED';
            if(this.ws.readyState === this.ws.CLOSED) {
                this.handleCloseCleanup();
            } else {
                this.ws.close();
            }
        }
    }

    private get isClosing(): boolean {
        return (this.state === 'CLOSING') || (this.state === 'CLOSING-ERROR');
    }

    buildMessage<
        Type extends ClientMessageType, 
        Message extends ClientMessage
    >(
        type: Type, 
        parameters: SelectParametersForType<Type, Message>
    ): ClientMessageBase<Type, typeof parameters> {
        return {
            version: '2',
            type,
            id: this.id,
            seq: ++this.seq,
            serverseq: this.serverseq,
            position: this.mediaSource.position.asDuration(),
            parameters
        };
    }

    sendMessage(message: ClientMessage): void {
        this.logger.debug(`sendMessage - Sending message: ${JSON.stringify(message, null, 1)}`);
        this.ws.send(JSON.stringify(message));
    }


    private stopPingTimer(): void {
        this.pingTimerInitial = this.pingTimerInitial?.cancel() ?? null;
        this.pingTimerInterval = this.pingTimerInterval?.cancel() ?? null;
    }

    private sendPing(): void {
        if(this.state === 'OPEN') {
            if(!this.pingTimerInterval) {
                this.pingTimerInterval = this.timeProvider.startInterval(() => this.sendPing(), this.options.pingInterval ?? DEFAULT_PING_INTERVAL);
            }
            if (this.pendingPing) {
                this.logger.warn(`sendPing - Pong for ping seq=${this.pendingPing.seq} not received in ping interval!`);
                this.signalFatalError(408, 'Timeout waiting for pong');
                // NOTE: We leave the pending ping as the pong might be in flight (and we don't want to flag it as erroneous pong)
            } else {
                const msg = this.buildMessage('ping', this.lastPingPongTime ? { rtt: StreamDuration.fromNanoseconds(this.lastPingPongTime).asDuration() } : {});
                this.pendingPing = { timestamp: this.timeProvider.getHighresTimestamp(), seq: msg.seq };
                if (this.pingTimerInitial) {
                    this.pingMsg = msg;
                }
                this.sendMessage(msg);
            }
        } else {
            this.stopPingTimer();
        }
    }

    private sendErrorMessage(code: ErrorCode, message: string): void {
        this.sendMessage(this.buildMessage('error', { code, message }));
    }

    private sendUpdateMessage(new_lang: string): void {
        this.sendMessage(this.buildMessage('update', { 'language' : new_lang }));
    }

    private sendUnexpectedMessageError(msg: ServerMessage): void {
        this.logger.warn(`Unexpected '${msg.type}' message in state ${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        this.signalFatalError(409, `Unexpected '${msg.type}' message in state ${this.state}`);
    }


    private signalFatalError(code: ErrorCode, message: string): void {
        if((this.state !== 'CLOSED') && (this.state !== 'DISCONNECTED') && (this.state !== 'CLOSING-ERROR')) {
            this.sendErrorMessage(code, message);
            this.initiateClose('error');
        }
    }

    private handleCloseCleanup(): void {
        if(this.state !== 'DISCONNECTED') {
            this.stopPingTimer();
            this.openTimer = this.openTimer?.cancel() ?? null;
            this.closeTimer = this.closeTimer?.cancel() ?? null;
            this.mediaSource.close();
            this.state = 'DISCONNECTED';
            this.emit('disconnected');
            for(let item = this.closeFinal.pop(); item; item = this.closeFinal.pop()) {
                item.resolve();
            }
        }
    }

    onWsOpen(): void {
        if (this.state !== 'CONNECTING') {
            this.logger.error(`Websocket 'open' event in state ${this.state}`);
            return this.signalFatalError(500, 'Internal client error');
        }
        this.state = 'PREPARING';

        const sendOpenMessage = (parameters: OpenParameters) => {
            if(this.state == 'PREPARING') {
                this.openParameters = parameters;
                const msg = this.buildMessage('open', this.openParameters);
                this.sendMessage(msg);
                if(this.state === 'PREPARING') {
                    this.state = 'OPENING';
                    this.openTimer = this.timeProvider.startTimeout(() => {
                        this.openTimer = null;
                        this.signalFatalError(408, 'Open transaction timeout');
                    }, this.options.openTimeout ?? DEFAULT_OPEN_TIMEOUT);
                }
            }
        };
        
        if(this.options.openParameterProvider) {
            const result = this.options.openParameterProvider(this, {
                organizationId: this.organizationId,
                conversationId: this.options.conversationId,
                participant: this.options.participant,
                media: this.mediaSource.offeredMedia,
                customConfig: this.options.customConfigParam,
                language: this.options.languageParam,
                supportedLanguages: this.options.supportedLanguages
            });
            if(isPromise(result)) {
                result.then(params => {
                    sendOpenMessage(params);
                }).catch(err => {
                    this.logger.error(`Error processing message: ${normalizeError(err).stack}`);
                    this.signalFatalError(500, 'Internal client error');
                });
            } else {
                sendOpenMessage(result);
            }
        } else {
            sendOpenMessage({
                organizationId: this.organizationId,
                conversationId: this.options.conversationId ?? uuid(),
                participant: this.options.participant ?? {
                    id: uuid(),
                    ani: '',
                    aniName: '',
                    dnis: '',
                },
                media: this.mediaSource.offeredMedia,
                customConfig: this.options.customConfigParam,
                language: this.options.languageParam,
                supportedLanguages: this.options.supportedLanguages
            });
        }
    }

    onWsClose(code: number): void {
        if(this.state === 'CLOSED') {
            this.logger.info(`Websocket close - Code: ${code}`);
        } else {
            // TODO: This should trigger a reconnect attempt
            this.logger.warn(`Websocket close - WebSocket closed unexpectedly in state ${this.state}! Code: ${code}`);
        }
        this.handleCloseCleanup();
    }

    onTextMessage(data: string): void {
        if (data.length > 65535) {
            return this.signalFatalError(413, 'Message too large');
        }
        let msg: unknown;
        try {
            msg = JSON.parse(data);
        } catch (error) {
            this.logger.warn(`Text message not valid JSON: ${normalizeError(error).message}`);
            return this.signalFatalError(400, 'Message not well-formed JSON');
        }
        if (!isServerMessageBase(msg)) {
            this.logger.warn(`Text message (parsed) is not a server message: ${JSON.stringify(msg, null, 1)}`);
            return this.signalFatalError(400, 'Message not an AudioHook server message');
        }
        this.onServerMessageBase(msg);
    }

    onBinaryMessage(data: Uint8Array): void {
        this.logger.info(`Websocket binary message. Size: ${data.length}, Data: ${data.slice(0, 512)}`);
        this.signalFatalError(415, 'Unexpected binary message');
    }

    onServerMessageBase(message: ServerMessageBase): void {
        if (message.seq !== this.serverseq + 1) {

            throw new Error(`Protocol error: Current serverseq=${this.serverseq} and incoming message has seq=${message.seq}`);
        }
        this.serverseq = message.seq;
        if (!isServerMessage(message)) {
            throw new Error(`Unsupported client message type: '${message.type}'`);
        }
        this.messageDispatch[message.type](message as never);
    }

    
    onClosedMessage(msg: ClosedMessage): void {
        this.logger.debug(`onClosedMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        this.closedMsg = msg;
        if(this.isClosing) {
            this.logger.info(`onClosedMessage - Session closed (state: ${this.state})`);
            this.closeTimer = this.closeTimer?.cancel() ?? null;
            this.initiateDisconnect();
        } else {
            this.sendUnexpectedMessageError(msg);
        }
    }

    onDisconnectMessage(msg: DisconnectMessage): void {
        // Note: disconnect messages are always OK and might just be ignored.
        this.logger.debug(`onDisconnectMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        if (!this.isClosing && (this.state !== 'CLOSED') && (this.state !== 'DISCONNECTED')) {
            this.logger.info(`onDisconnectMessage - Disconnect in state ${this.state}, reason: ${msg.parameters.reason}, info: ${msg.parameters.info ? JSON.stringify(msg.parameters.info) : '<none>'}`);
            this.initiateClose('disconnect');
        }
    }

    onEventMessage(msg: EventMessage): void {
        this.logger.debug(`onEventMessage - state=${this.state}, Message}: ${JSON.stringify(msg, null, 1)}`);
        if(msg.parameters['entities'][0].type === 'transcript') {
            this.transcripts.push(msg.parameters['entities'][0].data as EventEntityDataTranscript);
        }
        if(!this.emit('event', msg.parameters)) {
            this.logger.info(`onEventMessage - Event message (state: ${this.state}), no listener. Parameters: ${JSON.stringify(msg.parameters, null, 1)}`);
        }
    }

    onOpenedMessage(msg: OpenedMessage): void {
        this.logger.debug(`onOpenedMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        if (this.state !== 'OPENING') {
            this.sendUnexpectedMessageError(msg);
        } else {
            this.logger.info(`onOpenedMessage - Session open! Parameters: ${JSON.stringify(msg.parameters)}`);
            this.state = 'OPEN';
            this.openedMsg = msg;
            this.openTimer = this.openTimer?.cancel() ?? null;
            if (msg.parameters.media.length > 1) {
                this.signalFatalError(400, 'More than one media selected');
                return;
            }
            const selectedMedia: MediaParameter | null = msg.parameters.media[0] ?? null;
            if (selectedMedia) {
                const match = this.mediaSource.offeredMedia.filter(m => (
                    (m.format === selectedMedia.format) &&
                    (m.rate === selectedMedia.rate) &&
                    (m.type === selectedMedia.type) &&
                    (m.channels.length === selectedMedia.channels.length) &&
                    (m.channels.every((c, i) => (c === selectedMedia.channels[i])))
                ));
                if (match.length === 0) {
                    this.signalFatalError(400, 'Selected media not one of the offered');
                    return;
                }
            }
            let discardTo: StreamDuration | undefined;
            if(msg.parameters.discardTo) {
                discardTo = StreamDuration.fromString(msg.parameters.discardTo);
            }
            this.mediaSource.startStreaming(selectedMedia, discardTo, msg.parameters.startPaused);

            this.pingTimerInitial = this.timeProvider.startTimeout(() => {
                this.sendPing();
            }, this.options.initialPingDelay ?? DEFAULT_INITIAL_PING_DELAY);
        }
    }

    onPongMessage(msg: PongMessage): void {
        if(this.pongMsg === undefined) {
            this.pongMsg = msg;
        }
        const pongReceivedTime = this.timeProvider.getHighresTimestamp();
        if (!this.pendingPing) {
            this.logger.warn(`onPongMessage - Pong received without outstanding ping. ${JSON.stringify(msg, null, 1)}`);
            this.sendErrorMessage(409, 'Unexpected \'pong\' (no outstanding \'ping\')');

        } else if (this.pendingPing.seq !== msg.clientseq) {
            this.logger.warn(`onPongMessage - The pong message's clientseq (${msg.clientseq}) differs from ping's seq (${this.pendingPing.seq})`);
            this.sendErrorMessage(400, 'The "clientseq" of the \'pong\' message must match "seq" of the \'ping\' message.');

        } else if(this.state === 'OPEN') {
            this.logger.debug(`onPongMessage - ${JSON.stringify(msg, null, 1)}`);
            this.lastPingPongTime = pongReceivedTime - this.pendingPing.timestamp;
            this.logger.info(`onPongMessage - rtt: ${this.lastPingPongTime}ns`);
            this.emit('rttInfo', Number(this.lastPingPongTime)/1000000000.0);
            this.pendingPing = null;
            if (this.pingTimerInitial) {
                // This is the response to initial probe ping. Immediately send another one for server to get initial RTT measurement.
                this.pingTimerInitial = null;
                this.sendPing();
            }

        } else {
            this.logger.info(`onPongMessage - Ignoring 'pong' in state ${this.state} (straggler or late)`);
            this.pendingPing = null;
        }
    }

    onPauseMessage(msg: PauseMessage): void {
        this.logger.debug(`onPauseMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        if(this.state === 'OPEN') {
            this.logger.info(`onPauseMessage - Pausing media source (state: ${this.state})`);
            this.mediaSource.pause();

        } else if(this.isClosing) {
            // TODO: Check whether message was sent after 'close' received.
            this.logger.info(`onPauseMessage - Ignoring message in state ${this.state}`);
        } else {
            this.sendUnexpectedMessageError(msg);
        }
    }

    onReconnectMessage(msg: ReconnectMessage): void {
        this.logger.info(`onReconnectMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
    }

    onResumeMessage(msg: ResumeMessage): void {
        this.logger.debug(`onResumeMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
        if(this.state === 'OPEN') {
            this.logger.info(`onResumeMessage - Resuming media source (state: ${this.state})`);
            this.mediaSource.resume();
        } else if(this.isClosing) {
            // TODO: Check whether message was sent after 'close' received.
            this.logger.info(`onResumeMessage - Ignoring message in state ${this.state}`);
        } else {
            this.sendUnexpectedMessageError(msg);
        }
    }

    onUpdatedMessage(msg: UpdatedMessage): void {
        this.logger.info(`onUpdatedMessage - state=${this.state}, Message: ${JSON.stringify(msg, null, 1)}`);
    }

    override emit(eventName: 'disconnected', ...args: Parameters<OmitThisParameter<OnDisconnectedHandler>>): boolean;
    override emit(eventName: 'event', ...args: Parameters<OmitThisParameter<OnEventHandler>>): boolean;
    override emit(eventName: 'rttInfo', ...args: Parameters<OmitThisParameter<OnRttInfoHandler>>): boolean;
    override emit(eventName: string, ...args: unknown[]): boolean {
        return super.emit(eventName, ...args);
    }
}
