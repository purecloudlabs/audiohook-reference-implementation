export class EnergyCalculator {
    private segmentsCounter: number;
    private avgEnergy: number;
    private totalAvgEnergy: number;
    private maxEnergy: number;

    constructor() {
        this.segmentsCounter = 0;
        this.avgEnergy = 0;
        this.totalAvgEnergy = 0;
        this.maxEnergy = 0;
    }

    public calculateEnergy(segment: Uint8Array): void {
        this.segmentsCounter++;
        this.maxEnergy = 0x7F; //lower is higher due to (& 0x7F)
        this.avgEnergy = 0;
        const theStep = 1;
        let j = 0;
        const loopTo = segment.length - theStep - 1;

        for (let i = 0; i <= loopTo; i += theStep) {
            // const ne = Math.abs(segment[i] & 0x7F);
            const ne = segment[i] & 0x7F;
            if (ne < this.maxEnergy) {
                this.maxEnergy = ne;
            }

            this.avgEnergy += ne;
            j++;
        }

        if (j > 0) {
            this.avgEnergy /= j;
        }
    }

    private calculateTotalAverageEnergy(averageEnergy: number): void {
        if (this.totalAvgEnergy === 0) {
            this.totalAvgEnergy = this.avgEnergy;
        } else {
            this.totalAvgEnergy =
                (this.totalAvgEnergy * (this.segmentsCounter / (this.segmentsCounter + 1))) +
                averageEnergy / (this.segmentsCounter + 1);
        }
    }

    public getAvgEnergy(): number {
        return this.avgEnergy;
    }

    public getMaxEnergy(): number {
        return this.maxEnergy;
    }
}
