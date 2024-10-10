import { emitKeypressEvents } from 'readline';
import { Command, InvalidArgumentError } from 'commander';
import { pino } from 'pino';
import { v4 as uuid } from 'uuid';
import {
    ClientSession,
    createClientSession,
    isJsonObject,
    isUuid,
    JsonObject,
    MediaSource,
    StreamDuration
} from '../../app/audiohook';
import { createClientWebSocket } from './clientwebsocket';
import { createWavMediaSource } from './mediasource-wav';
import { createToneMediaSource } from './mediasource-tone';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TDigest } = require('tdigest');

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

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
type LogLevel = typeof logLevels[number];


const roundTripTimeDigest = new TDigest();

const printRttDigest = () => {
    roundTripTimeDigest.compress();
    const size = roundTripTimeDigest.size();

    const formattedValue = (p: number): string => (
        `${(roundTripTimeDigest.percentile(p)*1000.0).toFixed(3).padStart(8, ' ')} ms`
    );

    if(size > 0) {
        logger.info(`\
RTT digest:\n\
  samples(approx): ${roundTripTimeDigest.n}\n\
  centroids:       ${size}\n\
  percentiles:\n\
    min   = ${formattedValue(0)}\n\
    p10   = ${formattedValue(0.10)}\n\
    p25   = ${formattedValue(0.25)}\n\
    p50   = ${formattedValue(0.50)}\n\
    p75   = ${formattedValue(0.75)}\n\
    p80   = ${formattedValue(0.80)}\n\
    p85   = ${formattedValue(0.85)}\n\
    p90   = ${formattedValue(0.90)}\n\
    p95   = ${formattedValue(0.95)}\n\
    p98   = ${formattedValue(0.98)}\n\
    p99   = ${formattedValue(0.99)}\n\
    p999  = ${formattedValue(0.999)}\n\
    p9999 = ${formattedValue(0.9999)}\n\
    max   = ${formattedValue(1.0)}\n\
        `);
    }
};

// Print RTT digest every 30s
setInterval(
    () => {
        printRttDigest();
    }, 
    30000
);


let sessions: ClientSession[] = [];
let closing = false;

const checkActiveSessions = () => {
    if(sessions.length === 0) {
        printRttDigest();
        logger.info('All sessions disconnected, exiting');
        setImmediate(() => {
            process.exit(0);
        });
    } else if(closing) {
        logger.info(`Waiting for ${sessions.length} session(s) to close`);
    }
};

const parseApiKey = (value: string, previous: string | undefined): string => {
    if((previous?.length ?? 0) !== 0) {
        throw new InvalidArgumentError('Multiple API keys not allowed');
    }
    if(!/^[a-zA-Z0-9+/_-]+={0,2}$/.test(value)) {
        throw new InvalidArgumentError('API key must match regex: ^[a-zA-Z0-9+/_-]+={0,2}$');
    }
    return value;
};

const parseClientSecret = (value: string, previous: Uint8Array | undefined): Uint8Array => {
    if(previous) {
        throw new InvalidArgumentError('Multiple client secrets not allowed');
    }
    if(!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{3}=?|[A-Za-z\d+/]{2}(?:==)?)?$/.test(value)) {
        throw new InvalidArgumentError('Client secret must be base-64 encoded byte sequence.');
    }
    return Buffer.from(value, 'base64');
};

const parseCustomConfig = (value: string, previous: JsonObject | undefined): JsonObject => {
    let json;
    try {
        json = JSON.parse(value);
    } catch(err) {
        throw new InvalidArgumentError(`Not valid JSON: ${err instanceof Error ? err.message : ''}`);
    }
    if(!isJsonObject(json)) {
        throw new InvalidArgumentError('Not a valid JSON Object');
    }
    return { ...previous, ...json };
};

const parseSessionCount = (value: string) => {
    const tmp = parseInt(value, 10);
    if(isNaN(tmp) || (tmp < 0) || (tmp > 1024)) {
        throw new InvalidArgumentError('Session count must be integer in range 1...1024');
    }
    return tmp;
};

const parseStreamDuration = (value: string): StreamDuration => {
    if(value.startsWith('P')) {
        return StreamDuration.fromString(value);
    }
    const tmp = parseFloat(value);
    if(isNaN(tmp)) {
        throw new InvalidArgumentError('Invalid max-stream-duration value');
    }
    return StreamDuration.fromSeconds(tmp);
};

const parseOrgid = (value: string): string => {
    if(isUuid(value)) {
        return value;
    }
    throw new InvalidArgumentError('Expect UUID for orgid parameter');
};

const parseConnectionRate = (value: string): number => {
    const tmp = parseFloat(value);
    if(isNaN(tmp) || (tmp < 0.1) || (tmp > 10000)) {
        throw new InvalidArgumentError('Invalid connection rate');
    }
    return tmp;
};

const checkLogLevels = (value: string): LogLevel => {
    const tmp = value.toLowerCase();
    if(logLevels.every(x => x !== tmp)) {
        throw new InvalidArgumentError(`Unsupported log level: '${tmp}'. Valid levels: ${logLevels.join(',')}`);
    }
    return tmp as LogLevel;
};

type CmdOptions = {
    uri?: string;
    wavfile?: string;
    apiKey?: string;
    clientSecret?: Uint8Array;
    customConfig?: JsonObject;
    language?: string;
    supportedLanguages?: boolean;
    sessionCount?: number;
    maxStreamDuration?: StreamDuration;
    connectionProbe?: boolean;
    orgid?: string;
    connectionRate: number;
    sessionLogLevel: LogLevel;
};

new Command()
    .description('Test command line client for AudioHook.')
    .showHelpAfterError()
    .argument('[serveruri]', 'URI (wss://) of AudioHook server.')
    .option('--uri <uri>', 'URI (wss://) of AudioHook server.')
    .option('--wavfile <wavfile>', 'Filename of the WAV file to send')
    .option('--api-key <apikey>', 'API Key value', parseApiKey)
    .option('--client-secret <base64>', 'Client secret for message signature', parseClientSecret)
    .option('--custom-config <json>', 'Stringified JSON object to be passed as "customConfig" parameter in \'open\' message', parseCustomConfig)
    .option('--language <language>', 'Provides the language code used to test the call.')
    .option('--supported-languages', 'Fetches the list of supported languages')
    .option('--session-count <number>', 'Number of concurrent sessions to establish to server. Default: 1', parseSessionCount)
    .option('--max-stream-duration <duration>', 'Limit duration of audio stream to specified number of seconds or as PTxS. Default: length of source', parseStreamDuration)
    .option('--connection-probe', 'Perform a connection probe as documented in protocol specification. No audio is sent unless \'max-stream-duration parameter\' provided.')
    .option('--orgid <uuid>', 'Organization/tenant identifier UUID. Default: Unique random', parseOrgid)
    .option('--connection-rate <number>', 'Average rate at which sessions are created in connections per second. Valid range: 0.1 to 10000, Default: 50', parseConnectionRate, 50)
    .option('--session-log-level <level>', 'Logging level for per-session messages. Default: \'info\'', checkLogLevels, 'info')
    .action(async (serveruri: string | undefined, options: CmdOptions, command: Command): Promise<void> => {
        if(options.uri && serveruri) {
            command.error('More than one server URI specified!');
        }
        const uri = options.uri ?? serveruri;
        if(!uri) {
            command.error('No server URI specified!');
        }
        const connectionProbe = options.connectionProbe ?? false;
        if(connectionProbe && options.wavfile) {
            command.error('The connection-probe and wavfile options are mutually exclusive');
        }
        const organizationId = options.orgid ?? uuid();
        const sessionCount = options.sessionCount ?? 1;

        // Poisson-distribute creation of connections with given average rate (number of connections per second)
        // Create sorted array of random absolute arrival, uh, start times when respective session is to be established.
        const startDuration = sessionCount/options.connectionRate*1000;
        const now = Date.now();
        const startTimes = sessionCount < 2 ? [now] : [...Array(sessionCount)].map(() => Math.random()*startDuration + now).sort((a, b) => (a - b));
        let starting = true;
        for (let i = 0; i < sessionCount; ++i) {
            // Calculate "inter-arrival" delay for this session (i.e. how long do we have to wait for its scheduled start time)
            const delay = Math.round(startTimes[i] - Date.now());
            if(delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            if(closing) {
                break;
            }
            const sessionId = uuid();
            const sessionLogger = logger.child({ session: sessionId }, { level: options.sessionLogLevel });

            let mediaSource: MediaSource;
            if(connectionProbe) {
                mediaSource = createToneMediaSource(options.maxStreamDuration ?? StreamDuration.zero);
            } else if(options.wavfile) {
                mediaSource = await createWavMediaSource(options.wavfile, options.maxStreamDuration);
            } else {
                mediaSource = createToneMediaSource(options.maxStreamDuration);
            }
            const session = createClientSession({
                uri,
                mediaSource,
                organizationId,
                sessionId,
                conversationId: connectionProbe ? '00000000-0000-0000-0000-000000000000' : uuid(),
                participant: connectionProbe ? {
                    id: '00000000-0000-0000-0000-000000000000',
                    ani: '',
                    aniName: '',
                    dnis: '',
                } : {
                    id: uuid(),
                    ani: '+1-555-555-1234',
                    aniName: 'John Doe',
                    dnis: '+1-800-555-6789',
                },
                customConfigParam: options.customConfig,
                languageParam: options.language ?? undefined,
                supportedLanguages: options.supportedLanguages ?? undefined,
                createWebSocket: createClientWebSocket,
                logger: sessionLogger,
                authInfo: {
                    apiKey: options.apiKey ?? 'test-api-key',
                    clientSecret: options.clientSecret ?? null
                },
            });
            session.on('event', (parameters) => {
                sessionLogger.info(`Event message: ${JSON.stringify(parameters, null, 1)}`);
            });
            session.on('rttInfo', (rtt) => {
                roundTripTimeDigest.push(rtt);
            });
            session.once('disconnected', () => {
                sessions = sessions.filter(s => s.id !== session.id);
                if(starting) {
                    logger.info(`Session ${session.id} closed and disconnected. Still launching others.`);
                } else {
                    logger.info(`Session ${session.id} closed and disconnected. ${sessions.length} session(s) remaining.`);
                    checkActiveSessions();
                }
            });
            logger.info(`Session ${i+1} of ${sessionCount} created. SessionId: ${sessionId}`);
            sessions.push(session);
        }
        starting = false;
        checkActiveSessions();
    })
    .parseAsync(process.argv);

const closer = () => {
    logger.info('Closing...');
    closing = true;
    Promise.allSettled(sessions.map(s => s.close()))
        .then(result => {
            const code = result.every(({ status }) => status === 'fulfilled') ? 0 : 1;
            setImmediate(() => {
                process.exit(code);
            });
        })
        .catch(() => {
            setImmediate(() => {
                process.exit(1);
            });
        });
};

emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

let ctrlcHit = false;
process.stdin.on('keypress', (str, key) => {
    if(key.ctrl && (key.name === 'c' || key.name === 'd')) {
        if(!ctrlcHit) {
            closer();
            ctrlcHit = true;
        } else {
            logger.warn('Terminating now!');
            process.exit(1);    // If hit twice, exit immediately
        }
    } else {
        logger.info(`You pressed the ${JSON.stringify(str)} key: ${JSON.stringify(key)}`);
    }
});

process.once('SIGTERM', () => {
    logger.info('SIGTERM!');
    closer();
});

process.once('SIGINT', () => {
    logger.info('SIGINT!');
    closer();
});
