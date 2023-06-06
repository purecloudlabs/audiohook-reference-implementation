import { EventEmitter } from 'events';
import {
    AudioParameter,
    createAudioFrame,
    createWavFileReader,
    MediaChannel,
    MediaChannels,
    MediaFormat,
    MediaParameter,
    MediaParameters,
    MediaRate,
    MediaSource,
    MediaSourceState,
    normalizeError,
    OnMediaSourceAudioHandler,
    OnMediaSourceClosedHandler,
    OnMediaSourceDiscardedHandler,
    OnMediaSourceEndHandler,
    OnMediaSourceErrorHandler,
    OnMediaSourcePausedHandler,
    OnMediaSourceResumedHandler,
    StreamDuration,
    WavReader,
} from '../../app/audiohook';

class MediaSourceWav extends EventEmitter implements MediaSource {
    readonly offeredMedia: MediaParameters;
    selectedMedia: MediaParameter | null = null;
    state: MediaSourceState = 'PREPARING';
    private readonly reader: WavReader;
    private readonly sampleRate: MediaRate;
    private readonly sampleEndPos: number;
    private samplePos = 0;
    private pauseStartPos = 0;
    private audioTimer: NodeJS.Timeout | null = null;
    private frameDurationMs = 200;
    private startPaused = false;

    constructor(reader: WavReader, maxDuration?: StreamDuration) {
        super();
        this.reader = reader;
        this.sampleRate = reader.rate as MediaRate;
        this.sampleEndPos = Math.min(maxDuration ? Math.trunc(maxDuration.seconds*this.sampleRate) : this.reader.totalSamples, this.reader.totalSamples);
        if (reader.channels === 2) {
            const channels: MediaChannels[] = [['external', 'internal'], ['external'], ['internal']];
            this.offeredMedia = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: this.sampleRate }));
        } else {
            const channels: MediaChannels[] = [['external'], ['internal']];
            this.offeredMedia = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: this.sampleRate }));
        }
    }

    streamEnd() {
        if (this.audioTimer) {
            clearInterval(this.audioTimer);
            this.audioTimer = null;
            this.state = 'END';
            this.emit('end', StreamDuration.fromSamples(this.samplePos, this.sampleRate));
        }
    }

    startStreaming(selectedMedia: MediaParameter | null, discardTo?: StreamDuration, startPaused?: boolean): void {
        if(this.state !== 'PREPARING') {
            throw new Error(`Cannot start stream in state '${this.state}'`);
        }
        if (this.audioTimer) {
            clearInterval(this.audioTimer);
        }
        this.selectedMedia = selectedMedia;

        let discardSamples = 0;
        if(discardTo) {
            const samplesPerFrame = Math.trunc((this.frameDurationMs * this.sampleRate) / 1000);
            const newSamplePosRaw = Math.round(discardTo.seconds*this.sampleRate);
            const newSamplePos = Math.min(this.sampleEndPos, Math.floor(newSamplePosRaw/samplesPerFrame)*samplesPerFrame);
            if(this.samplePos < newSamplePos) {
                discardSamples = newSamplePos - this.samplePos;
            }
        }
        this.startPaused = startPaused ?? false;
        if(discardSamples === 0) {
            this._startStreamAux(startPaused ?? false);
        } else {
            this.state = 'DISCARDING';
            this.reader.skip(discardSamples)
                .then((skipped) => {
                    const start = StreamDuration.fromSamples(this.samplePos, this.sampleRate);
                    const discarded = StreamDuration.fromSamples(skipped, this.sampleRate);
                    this.samplePos += skipped;
                    this.emit('discarded', start, discarded);
                    this._startStreamAux(startPaused ?? false);
                })
                .catch((err) => {
                    const error = normalizeError(err);
                    this.state = 'ERROR';
                    this.emit('error', error);
                    this.streamEnd();
                });
        }
    }

    private _startStreamAux(wasStartPaused: boolean): void {
        if((this.state !== 'PREPARING') && (this.state !== 'DISCARDING')) {
            return;
        }
        if(this.startPaused) {
            this.state = 'PAUSED';
            this.pauseStartPos = this.samplePos;
            this.emit('paused');
        } else {
            this.state = 'STREAMING';
            if(wasStartPaused) {
                // While we were discarding, 'resume' was called, acknowledge.
                this.emit('resumed', this.position, StreamDuration.zero);
            }
        }
        
        const samplesPerFrame = Math.trunc((this.frameDurationMs * this.sampleRate) / 1000);

        const srcFrameParams: AudioParameter<MediaChannel, MediaFormat, MediaRate> = {
            channels: this.selectedMedia ? this.selectedMedia.channels : (this.reader.channels === 2) ? ['external', 'internal'] : ['external'],
            format: this.reader.format,
            rate: this.sampleRate,
        };

        const handler = () => {
            const read = Math.max(0, Math.min(samplesPerFrame, this.sampleEndPos-this.samplePos));
            this.reader.readNext(read)
                .then(data => {
                    if (data) {
                        const srcFrame = createAudioFrame(data, srcFrameParams);
                        if (this.selectedMedia) {
                            let sendData: Uint8Array;
                            if (this.selectedMedia.channels.length === srcFrame.channels.length) {
                                // WAV file has same number of channels as what was accepted; just transcode to PCMU if necessary
                                sendData = srcFrame.as('PCMU').audio.data;
                            } else {
                                // WAV file is stereo but server is only interested in one channel, de-interleave
                                sendData = srcFrame.getChannelView(this.selectedMedia.channels[0], 'PCMU').data;
                            }
                            if(this.state === 'STREAMING') {
                                this.emit('audio', sendData);
                            }
                        }
                        this.samplePos += srcFrame.sampleCount;
                        if(this.samplePos >= this.sampleEndPos) {
                            this.streamEnd();
                        }
                    } else {
                        this.streamEnd();
                    }
                })
                .catch(err => {
                    const error = normalizeError(err);
                    this.state = 'ERROR';
                    this.emit('error', error);
                    this.streamEnd();
                });
        };
        setImmediate(handler);
        this.audioTimer = setInterval(handler, this.frameDurationMs);
    }

    async close(): Promise<void> {
        this.streamEnd();
        if(this.state !== 'CLOSED') {
            await this.reader.close();
            this.state = 'CLOSED';
            this.emit('closed');
            this.removeAllListeners();
        }
    }

    pause(): void {
        if(this.state === 'PAUSED') {
            this.emit('paused');
        } else if(this.state === 'STREAMING') {
            this.state = 'PAUSED';
            this.pauseStartPos = this.samplePos;
            this.emit('paused');
        } else {
            this.startPaused = true;
        }
    }

    resume(): void {
        if(this.state === 'PAUSED') {
            this.state = 'STREAMING';
            this.emit('resumed', this.position, StreamDuration.fromSamples(this.samplePos - this.pauseStartPos, this.sampleRate));
        } else if(this.state === 'STREAMING') {
            this.emit('resumed', this.position, StreamDuration.zero);
        } else {
            this.startPaused = false;
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

export const createWavMediaSource = async (filename: string, maxDuration?: StreamDuration): Promise<MediaSource> => {
    const reader = await createWavFileReader(filename, {
        allowedRates: [8000],
        channelMin: 1,
        channelMax: 2
    });
    return new MediaSourceWav(reader, maxDuration);
};
