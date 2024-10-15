import ByteBuffer from 'bytebuffer';
import { VoiceEvent } from './voice-event';
import { EventType } from './event-type';
import { EnergyCalculator } from './energy-calculator';
import { MediaChannelId } from '../../../audiohook';

export class VoiceActivityDetector {
    private channelId: MediaChannelId;
    private audioBytesPerSec = 8000;
    private bytesPer100MilliSec: number = this.audioBytesPerSec / 10;
    private currentSegmentStartIndex = 0;
    private triggeredEndOfStream = false;
    private energyCalculator: EnergyCalculator = new EnergyCalculator();
    private voiceEventsThreshold = 2;
    private silenceEventsThreshold = 4;
    private voiceEventsCounter = 0;
    private silenceEventsCounter = 0;
    private startPos = -1;
    private segmentShorterThanMinimum: ByteBuffer | null = null;

    constructor(channelId: MediaChannelId) {
        this.channelId = channelId;
    }

    get getChannelId(): MediaChannelId {
        return this.channelId;
    }

    detectVoiceActivity(segmentBuffer: ByteBuffer): VoiceEvent[] {
        const voiceEvents: VoiceEvent[] = [];

        if (segmentBuffer !== null && segmentBuffer.remaining() > 0) {
            if (segmentBuffer.remaining() % 2 !== 0) {
                throw new Error('Voice Transcription SDK supports 8-bit audio only. segmentBuffer parameter must be with even number of bytes.');
            } else if (this.triggeredEndOfStream) {
                throw new Error('VoiceActivityDetector was already notified of end of stream. Invoking detectVoiceActivity() is not allowed.');
            } else {
                if (this.segmentShorterThanMinimum !== null && this.segmentShorterThanMinimum.remaining() > 0) {
                    segmentBuffer = ByteBuffer.concat([this.segmentShorterThanMinimum, segmentBuffer]);
                    this.segmentShorterThanMinimum = null;
                }
                segmentBuffer.offset = 0;
                segmentBuffer.markedOffset = -1;

                while (segmentBuffer.remaining() > 0) {
                    if (segmentBuffer.remaining() >= this.bytesPer100MilliSec) {
                        const event: EventType = this.handle100MillisecChunk(segmentBuffer);
                        if (event == EventType.VOICE) {
                            this.voiceEventsCounter++;
                            this.silenceEventsCounter = 0;
                        } else {
                            this.silenceEventsCounter++;
                            this.voiceEventsCounter = 0;
                        }
                        if (this.voiceEventsCounter == this.voiceEventsThreshold && this.startPos < 0) {
                            this.startPos = this.currentSegmentStartIndex - this.voiceEventsThreshold * this.bytesPer100MilliSec;
                            this.startPos = this.startPos < 0 ? 0 : this.startPos;
                            this.silenceEventsCounter = 0;
                        } else if (this.silenceEventsCounter == this.silenceEventsThreshold && this.startPos > -1) {
                            const endPos = this.currentSegmentStartIndex - this.silenceEventsThreshold * this.bytesPer100MilliSec;
                            voiceEvents.push(new VoiceEvent(this.startPos, endPos, this.audioBytesPerSec, 1));
                            this.voiceEventsCounter = 0;
                            this.startPos = -1;
                        }
                        this.currentSegmentStartIndex += this.bytesPer100MilliSec;
                    } else {
                        this.handleChunkLessThan100Millisec(segmentBuffer);
                    }
                }
                return voiceEvents;
            }
        } else {
            return voiceEvents;
        }
    }

    private handle100MillisecChunk(segmentBuffer: ByteBuffer): EventType {
        const chunk: Uint8Array = new Uint8Array(this.bytesPer100MilliSec);
        this.getTypedArray(chunk, segmentBuffer, this.bytesPer100MilliSec);
        return this.getEventTypeOn8BitAudio(chunk);
    }

    private handleChunkLessThan100Millisec(segmentBuffer: ByteBuffer): void {
        const chunk: Uint8Array = new Uint8Array(segmentBuffer.remaining());
        this.getTypedArray(chunk, segmentBuffer);
        this.segmentShorterThanMinimum = ByteBuffer.wrap(chunk);
    }

    private getEventTypeOn8BitAudio(chunk: Uint8Array): EventType {
        this.energyCalculator.calculateEnergy(chunk);
        // lower value of energy corresponds to higher energy i.e. 0 is highest energy whereas 127 is the lowest energy
        return this.energyCalculator.getMaxEnergy() < 80 && this.energyCalculator.getAvgEnergy() < 110 ? EventType.VOICE : EventType.SILENCE;
    }

    public notifyEndOfStream(): VoiceEvent[] {
        this.triggeredEndOfStream = true;
        const voiceEvents: VoiceEvent[] = [];
        if (this.startPos > -1) {
            const endPos = this.currentSegmentStartIndex - this.silenceEventsThreshold;
            voiceEvents.push(new VoiceEvent(this.startPos, endPos, this.audioBytesPerSec, 1));
        }
        return voiceEvents;
    }

    private getTypedArray(dst: Uint8Array | Int8Array, byteBuffer: ByteBuffer, length: number = byteBuffer.remaining()) {
        if (length > byteBuffer.remaining()) {
            throw new Error('Buffer Underflow');
        }
        let offset = byteBuffer.offset;
        for (let i = 0; i < length; i++, offset++) {
            if (dst instanceof Uint8Array) {
                dst[i] = byteBuffer.readUint8(i);
            } else if (dst instanceof Int8Array) {
                dst[i] = byteBuffer.readInt8(i);
            }
        }
        byteBuffer.offset = offset;
    }
}