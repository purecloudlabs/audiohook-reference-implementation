import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';
import { languageCodeRegex } from '../app/audiohook';

const supportedLanguagesToBe: MatcherFunction<[index: unknown]> =
    function (actual, index) {

        const pass = typeof actual === 'string' && languageCodeRegex.test(actual);

        if (pass) {
            return {
                message: () =>
                    `There is not an invalid language code.\nThe language code at index ${index}, ${actual}, is valid.`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `There is an invalid language code.\nThe language code at index ${index}, ${actual}, is not valid.`,
                pass: false,
            };
        }
    };

expect.extend({
    supportedLanguagesToBe,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        supportedLanguagesToBe(index: number): void;
    }
    interface Matchers<R> {
        supportedLanguagesToBe(index: number): R;
    }
}
