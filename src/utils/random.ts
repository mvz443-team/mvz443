import seedrandom from "seedrandom";

export const defaultRandom = seedrandom.alea("hello");
export const visualRandom = seedrandom.alea("mvz443:visual");

export function DistributePoints(arrLength: number, points: number): number[] {
    let arr = new Array(arrLength).fill(0);
    for (let i = 0; i < points; i++) {
        arr[Math.floor(visualRandom() * arrLength)]++;
    }
    return arr;
}
