import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

const rangeToBe: MatcherFunction<[name: unknown, location: unknown, upper: number, lower: number]> =
    function (actual, name, location, upper: number, lower: number) {
        const pass = (typeof actual === 'number' && actual <= upper && actual >= lower);
        if (pass && typeof actual === 'number') {
            return {
                message: () =>
                    `The ${name} at ${location} does fall between the ranges ${lower} and ${upper} when it should not. It was ${actual}.`,
                pass: true,
            };
        } else if (!(typeof actual === 'number')) {
            return {
                message: () =>
                    `The ${name} at ${location} is not of type number. Instead, it was of type ${typeof actual}`,
                pass: false,
            };
        } else {
            return {
                message: () =>
                    `The ${name} at ${location} does not fall between the ranges ${lower} and ${upper}. Instead it was ${actual}.`,
                pass: false,
            };
        }
    };

expect.extend({
    rangeToBe,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        rangeToBe(name: string, location: string, upper: number, lower:number): void;
    }
    interface Matchers<R> {
        rangeToBe(name: string, location: string, upper: number, lower:number): R;
    }
}


