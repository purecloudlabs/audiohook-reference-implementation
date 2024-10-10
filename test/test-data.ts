// accepted variance range for times
export const delta = 0.5;
// set of test asserted values for the normal transcript connector tests
export const transcript_info: Array<Map<string, number>> = [
    new Map([['offset', 0.1], ['duration', 0.4]]),
    new Map([['offset', 1.1], ['duration', 1.6]]),
    new Map([['offset', 2.9], ['duration', 1.2]]),
    new Map([['offset', 4.9], ['duration', 1.0]]),
    new Map([['offset', 6.7], ['duration', 2.6]]),
];
// seet of test asserted values for transcript connector tests with a break
export const transcript_info_longer:  Array<Map<string, number>> = [
    new Map([['offset', 0.1], ['duration', 0.4]]),
    new Map([['offset', 1.1], ['duration', 1.6]]),
    new Map([['offset', 2.9], ['duration', 1.2]]),
    new Map([['offset', 4.9], ['duration', 1.0]]),
    new Map([['offset', 6.7], ['duration', 1.3]]),
    new Map([['offset', 8.0], ['duration', 1.3]]),
];
