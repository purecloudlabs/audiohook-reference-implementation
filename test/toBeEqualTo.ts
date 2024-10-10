import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

const toBeEqualTo: MatcherFunction<[name: unknown, expected: unknown]> =
    function (actual, name, expected) {
        const pass = (actual === expected);

        if (pass) {
            return {
                message: () =>
                    `The current ${name} is ${this.utils.printReceived(
                        actual,
                    )}, but expected it not to be equal to ${this.utils.printExpected(
                        expected,
                    )}`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `Expected the ${name} to be equal to ${this.utils.printExpected(
                        expected,
                    )}`,
                pass: false,
            };
        }
    };

expect.extend({
    toBeEqualTo,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        toBeEqualTo(name: string, expected: unknown): void;
    }
    interface Matchers<R> {
        toBeEqualTo(name: string, expected: unknown): R;
    }
}


