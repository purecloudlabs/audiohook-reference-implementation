import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

const fieldToBePresent: MatcherFunction<[field: PropertyKey, location: unknown]> =
    function (actual, field: PropertyKey, location) {
        const pass = (typeof actual == 'object' && actual && actual.hasOwnProperty(field) && actual[field as keyof typeof actual] != undefined );
        if (pass) {
            return {
                message: () =>
                    `The ${field.toString()} at ${location} exists and is defined.`,
                pass: true,
            };
        } else {
            console.log(field.toString());
            return {
                message: () =>
                    `The ${field.toString()} at ${location} either does not exist or is undefined.`,
                pass: false,
            };
        }
    };

expect.extend({
    fieldToBePresent,
});

declare module 'expect' {
    interface AsymmetricMatchers {
        fieldToBePresent(field: PropertyKey, location: string): void;
    }
    interface Matchers<R> {
        fieldToBePresent(field: PropertyKey, location: string): R;
    }
}


