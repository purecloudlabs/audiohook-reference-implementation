import {
    MediaParameter,
    MediaParameters,
} from '../protocol/message';
import StreamDuration from '../utils/streamduration';

export type OnMediaSourceAudioHandler = (this: MediaSource, data: Uint8Array) => void;
export type OnMediaSourceDiscardedHandler = (this: MediaSource, start: StreamDuration, discarded: StreamDuration) => void;
export type OnMediaSourcePausedHandler = (this: MediaSource) => void;
export type OnMediaSourceResumedHandler = (this: MediaSource, start: StreamDuration, discarded: StreamDuration) => void;
export type OnMediaSourceErrorHandler = (this: MediaSource, error: Error) => void;
export type OnMediaSourceEndHandler = (this: MediaSource, duration: StreamDuration) => void;
export type OnMediaSourceClosedHandler = (this: MediaSource) => void;

export type MediaSourceState = 'PREPARING' | 'STREAMING' | 'DISCARDING' | 'PAUSED' | 'END' | 'ERROR' | 'CLOSED';

export interface MediaSource {
    readonly state: MediaSourceState;
    readonly position: StreamDuration;
    readonly offeredMedia: MediaParameters;
    readonly selectedMedia: MediaParameter | null;

    startStreaming(selectedMedia: MediaParameter | null, discardTo?: StreamDuration, startPaused?: boolean): void;

    close(): Promise<void>;

    pause(): void;
    resume(): void;

    on(event: 'audio', listener: OnMediaSourceAudioHandler): this;
    on(event: 'discarded', listener: OnMediaSourceDiscardedHandler): this;
    on(event: 'paused', listener: OnMediaSourcePausedHandler): this;
    on(event: 'resumed', listener: OnMediaSourceResumedHandler): this;
    on(event: 'end', listener: OnMediaSourceEndHandler): this;
    on(event: 'error', listener: OnMediaSourceErrorHandler): this;
    on(event: 'closed', listener: OnMediaSourceClosedHandler): this;

    off(event: 'audio', listener: OnMediaSourceAudioHandler): this;
    off(event: 'discarded', listener: OnMediaSourceDiscardedHandler): this;
    off(event: 'paused', listener: OnMediaSourcePausedHandler): this;
    off(event: 'resumed', listener: OnMediaSourceResumedHandler): this;
    off(event: 'end', listener: OnMediaSourceEndHandler): this;
    off(event: 'error', listener: OnMediaSourceErrorHandler): this;
    off(event: 'closed', listener: OnMediaSourceClosedHandler): this;

    once(event: 'audio', listener: OnMediaSourceAudioHandler): this;
    once(event: 'discarded', listener: OnMediaSourceDiscardedHandler): this;
    once(event: 'paused', listener: OnMediaSourcePausedHandler): this;
    once(event: 'resumed', listener: OnMediaSourceResumedHandler): this;
    once(event: 'end', listener: OnMediaSourceEndHandler): this;
    once(event: 'error', listener: OnMediaSourceErrorHandler): this;
    once(event: 'closed', listener: OnMediaSourceClosedHandler): this;
}
