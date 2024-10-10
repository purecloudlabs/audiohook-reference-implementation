import { EventEmitter } from 'events';
import {
    MediaChannels,
    MediaParameter,
    MediaParameters,
    MediaRate,
    MediaSource,
    MediaSourceState,
    OnMediaSourceAudioHandler,
    OnMediaSourceClosedHandler,
    OnMediaSourceDiscardedHandler,
    OnMediaSourceEndHandler,
    OnMediaSourceErrorHandler,
    OnMediaSourcePausedHandler,
    OnMediaSourceResumedHandler,
    StreamDuration,
} from '../../app/audiohook';

// 200ms of a mono and stereo 1kHz tone at 8kHz sample rate in u-law
const toneFrameDurationMs = 200;
const tone1kHz8kUlaw1ch = Uint8Array.from(new Array(toneFrameDurationMs).fill([0xFF, 0x0D, 0x06, 0x0D, 0xFF, 0x8D, 0x86, 0x8D]).flat());
const tone1kHz8kUlaw2ch = Uint8Array.from(new Array(toneFrameDurationMs).fill([0xFF, 0xFF, 0x0D, 0x0D, 0x06, 0x06, 0x0D, 0x0D, 0xFF, 0xFF, 0x8D, 0x8D, 0x86, 0x86, 0x8D, 0x8D]).flat());

class MediaSourceTone1kHz extends EventEmitter implements MediaSource {
    readonly offeredMedia: MediaParameters;
    selectedMedia: MediaParameter | null = null;
    state: MediaSourceState = 'PREPARING';
    private sampleRate: MediaRate = 8000;
    private samplePos = 0;
    private pauseStartPos = 0;
    private audioTimer: NodeJS.Timeout | null = null;
    private frameDurationMs: number;
    private readonly sampleEndPos: number;

    constructor(maxDuration?: StreamDuration, customMedia?: MediaParameters) {
        super();
        const channels: MediaChannels[] = [['external', 'internal'], ['external'], ['internal']];
        this.offeredMedia = (customMedia) ? customMedia : channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: this.sampleRate }));
        this.frameDurationMs = toneFrameDurationMs;
        this.sampleEndPos = Math.trunc((maxDuration?.seconds ?? 7*24*3600) * this.sampleRate);
    }

    startStreaming(selectedMedia: MediaParameter | null, discardTo?: StreamDuration, startPaused?: boolean): void {
        if(this.state !== 'PREPARING') {
            throw new Error(`Cannot start stream in state '${this.state}'`);
        }
        if(this.audioTimer) {
            clearInterval(this.audioTimer);
        }
        this.selectedMedia = selectedMedia;

        if(discardTo) {
            const samplesPerFrame = Math.trunc(this.frameDurationMs*this.sampleRate/1000);
            const newSamplePosRaw = Math.round(discardTo.seconds*this.sampleRate);
            let newSamplePos = Math.floor(newSamplePosRaw/samplesPerFrame)*samplesPerFrame;
            newSamplePos = Math.min(this.sampleEndPos, newSamplePos);
            if(this.samplePos < newSamplePos) {
                const start = StreamDuration.fromSamples(this.samplePos, this.sampleRate);
                const discarded = StreamDuration.fromSamples(newSamplePos - this.samplePos, this.sampleRate);
                this.samplePos = newSamplePos;
                this.state = 'DISCARDING';
                this.emit('discarded', start, discarded);
            }
        }

        if(startPaused) {
            this.state = 'PAUSED';
            this.pauseStartPos = this.samplePos;
            this.emit('paused');
        } else {
            this.state = 'STREAMING';
        }

        this._startStreamTimer();
    }
    private _startStreamTimer(): void {
        // Note: We run the timer even if we're paused, but don't emit the audio frames
        let handler: () => void;
        const samplesPerFrame = Math.trunc((this.frameDurationMs*this.sampleRate)/1000);
        if(this.selectedMedia) {
            const channels = this.selectedMedia.channels.length;
            const audioFrame = (channels === 2) ? tone1kHz8kUlaw2ch : tone1kHz8kUlaw1ch;
            handler = () => {
                const sampleCount = Math.min(this.sampleEndPos - this.samplePos, samplesPerFrame);
                if(this.state === 'STREAMING') {
                    if(sampleCount < samplesPerFrame) {
                        // Last frame, send partial
                        this.emit('audio', audioFrame.slice(0, sampleCount * channels));
                    } else {
                        this.emit('audio', audioFrame);
                    }
                }
                this.samplePos += sampleCount;
                if(this.samplePos >= this.sampleEndPos) {
                    this._signalEnd();
                }
            };
        } else {
            handler = () => {
                this.samplePos = Math.min(this.samplePos + samplesPerFrame, this.sampleEndPos);
                if(this.samplePos >= this.sampleEndPos) {
                    this._signalEnd();
                }
            };
        }
        setImmediate(handler);
        this.audioTimer = setInterval(handler, this.frameDurationMs);
    }

    private _signalEnd(): void {
        if(this.audioTimer) {
            clearInterval(this.audioTimer);
            this.audioTimer = null;
        }
        if((this.state !== 'END') && (this.state !== 'CLOSED')) { 
            this.state = 'END';
            this.emit('end', StreamDuration.fromSamples(this.samplePos, this.sampleRate));
        }
    }

    async close(): Promise<void> {
        if (this.audioTimer) {
            this._signalEnd();
        }
        if(this.state !== 'CLOSED') {
            this.state = 'CLOSED';
            this.emit('closed');
        }
        this.removeAllListeners();
    }

    pause(): void {
        if(this.state === 'PAUSED') {
            this.emit('paused');
        } else if(this.state === 'STREAMING') {
            this.state = 'PAUSED';
            this.pauseStartPos = this.samplePos;
            this.emit('paused');
        }
    }

    resume(): void {
        if(this.state === 'PAUSED') {
            this.state = 'STREAMING';
            const start = StreamDuration.fromSamples(this.pauseStartPos, this.sampleRate);
            const discarded = StreamDuration.fromSamples(this.samplePos - this.pauseStartPos, this.sampleRate);
            this.emit('resumed', start, discarded);
        } else if(this.state === 'STREAMING') {
            this.emit('resumed', this.position, StreamDuration.zero);
        }
    }

    get position(): StreamDuration {
        return StreamDuration.fromSamples(this.samplePos, this.sampleRate);
    }

    override emit(eventName: 'audio', ...args: Parameters<OmitThisParameter<OnMediaSourceAudioHandler>>): boolean;
    override emit(eventName: 'discarded', ...args: Parameters<OmitThisParameter<OnMediaSourceDiscardedHandler>>): boolean;
    override emit(eventName: 'paused', ...args: Parameters<OmitThisParameter<OnMediaSourcePausedHandler>>): boolean;
    override emit(eventName: 'resumed', ...args: Parameters<OmitThisParameter<OnMediaSourceResumedHandler>>): boolean;
    override emit(eventName: 'end', ...args: Parameters<OmitThisParameter<OnMediaSourceEndHandler>>): boolean;
    override emit(eventName: 'error', ...args: Parameters<OmitThisParameter<OnMediaSourceErrorHandler>>): boolean;
    override emit(eventName: 'closed', ...args: Parameters<OmitThisParameter<OnMediaSourceClosedHandler>>): boolean;
    override emit(eventName: string, ...args: unknown[]): boolean {
        return super.emit(eventName, ...args);
    }
}

export const createToneMediaSource = (maxDuration?: StreamDuration, customMedia?: MediaParameters): MediaSource => {
    return new MediaSourceTone1kHz(maxDuration, customMedia);
};
