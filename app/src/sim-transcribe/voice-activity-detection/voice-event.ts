
export class VoiceEvent {
    private startTime: number;
    private endTime: number;

    constructor(startIndex: number, endIndex: number, sampleRate: number, bytesPerSample: number) {
        this.startTime = startIndex / (sampleRate * bytesPerSample);
        this.endTime = endIndex / (sampleRate * bytesPerSample);
    }

    getStartTime(): number {
        return this.startTime;
    }

    getEndTime(): number {
        return this.endTime;
    }
}
