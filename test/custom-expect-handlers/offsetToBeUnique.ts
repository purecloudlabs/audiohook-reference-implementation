import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

const offsetToBeUnique: MatcherFunction<[offsets: Map<number, boolean>, location: unknown]> =
    function (actual, offsets: Map<number, boolean>, location) {
        const pass = (typeof actual == 'number' && offsets.get(actual) === undefined);
        if (pass) {
            return {
                message: () =>
                    `The offset ${actual} at ${location} has not already appeared when it should have.`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `The offset ${actual} at ${location} has already appeared when it should not have.`,
                pass: false,
            };
        }
    };

expect.extend({
    offsetToBeUnique,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        offsetToBeUnique(offsets: Map<number, boolean>, location: string): void;
    }
    interface Matchers<R> {
        offsetToBeUnique(offsets: Map<number, boolean>, location: string): R;
    }
}
