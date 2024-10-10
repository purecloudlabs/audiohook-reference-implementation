import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

const mediaToBe: MatcherFunction<[msg: unknown, expected: unknown]> =
    function (actual, msg, expected) {
        const pass = (actual === expected);

        if (pass) {
            return {
                message: () =>
                    `Got ${this.utils.printReceived(
                        actual,
                    )}, but expected ${this.utils.printExpected(
                        expected,
                    )}`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `${msg}`, 
                pass: false,
            };
        }
    };

expect.extend({
    mediaToBe,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        mediaToBe(msg: string, expected: unknown): void;
    }
    interface Matchers<R> {
        mediaToBe(msg: string, expected: unknown): R;
    }
}


