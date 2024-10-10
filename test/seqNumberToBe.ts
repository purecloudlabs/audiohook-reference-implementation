import {expect} from '@jest/globals';
import type {MatcherFunction} from 'expect';

const seqNumberToBe: MatcherFunction<[name: unknown, expected: unknown]> =
    function (actual, name, expected) {
        const pass = (actual === expected);

        if (pass) {
            return {
                message: () =>
                    `The Sequence Numbers in the client and server messages aren't matching.\nThe ${name}'s Sequence Number is ${this.utils.printReceived(
                        actual,
                    )}, but expected it not to be equal to ${this.utils.printExpected(
                        expected,
                    )}`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `The Sequence Numbers in the client and server messages aren't matching.\nThe ${name}'s Sequence Number should be ${this.utils.printExpected(
                        expected,
                    )}, but it is actually ${this.utils.printExpected(
                        actual,
                    )}`,
                pass: false,
            };
        }
    };

expect.extend({
    seqNumberToBe,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        seqNumberToBe(name: string, expected: unknown): void;
    }
    interface Matchers<R> {
        seqNumberToBe(name: string, expected: unknown): R;
    }
}


