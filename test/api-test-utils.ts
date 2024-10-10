import { pino } from 'pino';
import { v4 as uuid } from 'uuid';
import dotenv from 'dotenv';
import {
    createClientSession,
    MediaSource,
    StreamDuration,
} from '../app/audiohook';
import { Uuid, MediaParameters, JsonObject, LanguageCode } from '../app/audiohook';
import { createToneMediaSource } from '../client/src/mediasource-tone';
import { createWavMediaSource } from '../client/src/mediasource-wav';
import { createClientWebSocket } from '../client/src/clientwebsocket';
import { ClientSession } from '../app/audiohook';
import { expect } from '@jest/globals';
import './toBeEqualTo';
import './seqNumberToBe';
import './mediaToBe';
import './rangeToBe';
import './custom-expect-handlers/fieldToBePresent';
import './custom-expect-handlers/offsetToBeUnique';
import {
    Duration,
} from '../app/audiohook';

import ConfigParser from 'configparser';

dotenv.config();

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            translateTime: 'SYS:HH:MM:ss.l',
            colorize: true,
            ignore: 'pid,hostname'
        }
    }
});

const parseApiKey = (value: string, previous: string | undefined): string => {
    if((previous?.length ?? 0) !== 0) {
        throw new Error('Multiple API keys not allowed');
    }
    if(!/^[a-zA-Z0-9+/_-]+={0,2}$/.test(value)) {
        throw new Error('API key must match regex: ^[a-zA-Z0-9+/_-]+={0,2}$');
    }
    return value;
};

const parseClientSecret = (value: string, previous: Uint8Array | undefined): Uint8Array => {
    if(previous) {
        throw new Error('Multiple client secrets not allowed');
    }
    if(!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{3}=?|[A-Za-z\d+/]{2}(?:==)?)?$/.test(value)) {
        throw new Error('Client secret must be base-64 encoded byte sequence.');
    }
    return Buffer.from(value, 'base64');
};

function waitForClientState(session: ClientSession , state: string): Promise<void> {
    return new Promise<void>(function (resolve) {
        setTimeout(function () {
            if (session.state === state) {
                resolve();
            } else {
                waitForClientState(session, state).then(resolve);
            }
        }, 2);
    });
}

function waitForClosed(session: ClientSession): Promise<void> {
    return new Promise<void>(function (resolve) {
        setTimeout(function () {
            if (session.closedMsg === undefined) {
                waitForClosed(session).then(resolve);
            } else {
                resolve();
            }
        }, 2);
    });
}

function waitForPong(session: ClientSession): Promise<void> {
    return new Promise<void>(function (resolve) {
        setTimeout(function () {
            if (session.pongMsg != undefined) {
                resolve();
            } else {
                waitForPong(session).then(resolve);
            }
        }, 2);
    });
}

export type TestOpenParams = {
    sessionId: Uuid;
    media?: MediaParameters;
    customConfig?: JsonObject;
    language?: LanguageCode;
    supportedLanguages: boolean;
};

const parseDuration = (input: string): number => {
    let output = input.slice(2);
    output = output.substring(0, output.length - 1);
    return parseFloat(output);
};

let client: ClientSession;
let uri: string;
let apiKey: string;
let clientSecret: string;

const participant = {
    id: uuid(),
    ani: '+1-555-555-1234',
    aniName: 'John Doe',
    dnis: '+1-800-555-6789',
};

const getFromConfig = () => {
    const config = new ConfigParser();
    config.read('./testconfig.cfg');
    config.sections();

    uri = config.get('EndPoint', 'url') || '';
    apiKey = config.get('Authentication', 'apiKey') || '';
    clientSecret = config.get('Authentication', 'clientSecret') || '';

    if (!uri) {
        throw new Error('No server URI specified');
    }
    if (!apiKey) {
        throw new Error('No API Key specified');
    }
    if (!clientSecret) {
        throw new Error('No client secret specified');
    }
};

const createClientForAudiohook = async (orgId: string, openParams: TestOpenParams): Promise<ClientSession> => {
    const mediaSource: MediaSource = createToneMediaSource(undefined, openParams.media || undefined);

    const organizationId = orgId;
    const sessionId = openParams.sessionId;
    const sessionLogger = logger.child({ session: sessionId }, { level: 'silent' });

    client = createClientSession({
        uri,
        mediaSource,
        organizationId,
        sessionId,
        conversationId: uuid(),
        participant: participant,
        customConfigParam: openParams.customConfig,
        languageParam: openParams.language,
        createWebSocket: createClientWebSocket,
        logger: sessionLogger,
        authInfo: {
            apiKey: parseApiKey(apiKey, undefined),
            clientSecret: parseClientSecret(clientSecret, undefined)
        },
        supportedLanguages: openParams.supportedLanguages,
    });


    // Wait for the state to be OPEN before sending any message to the server
    await waitForClientState(client, 'OPEN');
    return client;
};

const createClientForTranscriptConnector = async (orgId: string, openParams: TestOpenParams): Promise<ClientSession> => {
    const mediaSource: MediaSource = await createWavMediaSource('./test/test-transcript-connector.wav', StreamDuration.fromSeconds(11));

    const organizationId = orgId;
    const sessionId = openParams.sessionId;
    const sessionLogger = logger.child({ session: sessionId }, { level: 'silent' });
    client = createClientSession({
        uri,
        mediaSource,
        organizationId,
        sessionId,
        conversationId: uuid(),
        participant: participant,
        customConfigParam: openParams.customConfig,
        languageParam: openParams.language,
        createWebSocket: createClientWebSocket,
        logger: sessionLogger,
        authInfo: {
            apiKey: parseApiKey(apiKey, undefined),
            clientSecret: parseClientSecret(clientSecret, undefined)
        },
        supportedLanguages: openParams.supportedLanguages,
    });

    // Wait for the state to be OPEN before sending any message to the server
    await waitForClientState(client, 'OPEN');
    return client;
};


const clientCloseMessage = async () => {
    await client.close();
};

const clientUpdateMessage = async (new_lang: string) => {
    await client.updating(new_lang);
};

const clientDiscardingMessage = async (startTime: Duration, durationTime: Duration) => {
    await client.discarding(startTime, durationTime);
};

const clientPauseMessage = async () => {
    await client.pausing();
};

const clientResumeMessage = async (start: Duration, discarded: Duration) => {
    await client.resuming(start, discarded);
};

const clientErrorMessage = async () => {
    await client.erroring();
};

const clientPingMessage = async () => {
    await client.pinging();
};

// Validations

/**
 *
 * @param clientMedia - all the media format possibilities sent by the client
 * @param selectedMedia - the media format selected by the server
 * @returns true if the server selects at most one of the media formats sent by the client
 */
function validateMediaParams(clientMedia: MediaParameters, selectedMedia?: MediaParameters) {
    if (!selectedMedia || selectedMedia.length == 0) { // undefined or empty
        expect(true).mediaToBe('', true); // the server can select an empty array
        return;
    }

    // the server must select at most one media format
    // The message is logged only when the expect fails
    expect(selectedMedia.length).mediaToBe('The server selected more than 1 media format, which is not allowed.', 1);

    const selected = selectedMedia[0];

    for (const media of clientMedia) {

        // verify the list of channels, type, format and rate
        if ((selected.channels.length !== media.channels.length) || (selected.type !== media.type) || (selected.format !== media.format) || (selected.rate !== media.rate)) {
            continue;
        }
        for (let i = 0; i < media.channels.length; i++) {
            if (selected.channels[i] !== media.channels[i]) {
                continue;
            }
        }
        expect(true).mediaToBe('', true); // the test passed
        return;
    }
    // forcing an error message since the test failed
    expect(false).mediaToBe('The server did not correctly select a media format. One or more of the selected channels, type, format or rate is incorrect.', true);
}

const delay = (ms: any) => new Promise(res => setTimeout(res, ms));

// Validates the common fields of messages => version, id, seq, clientseq
const commonValidations = (msg: any, client: ClientSession, id: string) => {
    expect(msg?.version).toBeEqualTo('Server Message\'s Version Number', '2');
    expect(msg?.id).toBeEqualTo('Server Message\'s id', id);
    expect(msg?.seq).seqNumberToBe('Server', client.serverseq);
    expect(msg?.clientseq).seqNumberToBe('Client', client.seq);
};

// Validates the transcript validations
const transcriptValidations = (client: ClientSession, transcript_info: Array<Map<string, number>>, delta: number) => {
    expect(client.transcripts.length).toBeEqualTo('Number of transcripts returned', transcript_info.length);
    // asserts each transcript 
    client.transcripts.forEach((value, index) => {
        // verification for EventEntityDataTranscript
        const transcript_index = index;
        expect(value).fieldToBePresent('isFinal',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        if (!value.isFinal) {  // does not check the rest if this is false
            return;
        }
        expect(value).fieldToBePresent('id',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        expect(value).fieldToBePresent('channel',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        expect(value).fieldToBePresent('offset',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        expect(value).fieldToBePresent('duration',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        const offset = parseDuration(value.offset!);
        expect(offset).rangeToBe('offset',`EventEntityDataTranscript at transcripts[${transcript_index}]`, transcript_info[index].get('offset')! + delta, transcript_info[index].get('offset')! - delta);
        const duration = parseDuration(value.duration!);
        expect(duration).rangeToBe('duration',`EventEntityDataTranscript at transcripts[${transcript_index}]`, transcript_info[index].get('duration')! + delta, transcript_info[index].get('duration')! - delta);
        expect(value).fieldToBePresent('alternatives',`EventEntityDataTranscript at transcripts[${transcript_index}]`);
        // must have at least one alternative
        expect(value.alternatives.length).not.toBeEqualTo('number of alternatives at transcripts[${transcript_index}]',0);
        value.alternatives.forEach((value, index) => {
            // verification for TranscriptAlternative
            const alternatives_index = index;
            expect(value).fieldToBePresent('confidence',`EventEntityDataTranscript.alternatives[${alternatives_index}] at transcripts[${transcript_index}]`);
            expect(value.confidence).rangeToBe('confidence',`EventEntityDataTranscript.alternatives[${alternatives_index}] at transcripts[${transcript_index}]`, 1.0, 0.0);
            expect(value).fieldToBePresent('interpretations',`EventEntityDataTranscript.alternatives[${alternatives_index}] at transcripts[${transcript_index}]`);
            expect(value.interpretations.length).not.toBeEqualTo(`number of interpretations at transcripts[${transcript_index}].alternatives[${alternatives_index}]`,0);
            value.interpretations.forEach((value, index) => {
                const interpretations_index = index;
                expect(value).fieldToBePresent('type',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                expect(value).fieldToBePresent('transcript',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                expect(value).fieldToBePresent('tokens',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                const offsets = new Map<number, boolean>(); // makes sure that positions are all different
                for (let i = 0; i < value.tokens!.length; i++) {
                    expect(value.tokens![i]).fieldToBePresent('type',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    expect(value.tokens![i]).fieldToBePresent('value',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    expect(value.tokens![i]).fieldToBePresent('confidence',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    expect(value.tokens![i]).fieldToBePresent('offset',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    expect(value.tokens![i]).fieldToBePresent('duration',`EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    const off = parseDuration(value.tokens![i].offset);
                    expect(off).offsetToBeUnique(offsets, `EventEntityDataTranscript.alternatives[${alternatives_index}].interpretations[${interpretations_index}] at transcripts[${transcript_index}]`);
                    offsets.set(off, true);
                }
            });
        });
    });
};

const print_transcript = (client: ClientSession) => {
    client.transcripts.forEach((value, index) => {
        value.alternatives.forEach((value, index) => {
            value.interpretations.forEach((value, index) => {
                for (let i = 0; i < value.tokens!.length; i++) {
                    console.log(value.tokens![i].value);
                }
            });
        });
    });
};

export { print_transcript, createClientForAudiohook, waitForPong,createClientForTranscriptConnector, clientPingMessage, clientCloseMessage, clientErrorMessage, clientUpdateMessage, clientPauseMessage, clientResumeMessage, clientDiscardingMessage, validateMediaParams, getFromConfig, commonValidations, delay, transcriptValidations, waitForClosed };