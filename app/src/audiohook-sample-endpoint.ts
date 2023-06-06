import { FastifyInstance } from 'fastify';
import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { RecordedSession, RecordingBucket } from './recordedsession';
import { initiateRequestAuthentication, verifyRequestSignature } from './authenticator';
import { isUuid, httpsignature as httpsig, ServerSession, createServerSession } from '../audiohook';
import { addAgentAssist } from './agentassist-hack';
import { SessionWebsocketStatsTracker } from './session-websocket-stats-tracker';

dotenv.config();

const isDev = process.env['NODE_ENV'] !== 'production';


declare module 'fastify' {
    interface FastifyRequest {
        authenticated?: boolean;
    }
}

type AuthStrategy = 'request' | 'session';

export const addAudiohookSampleRoute = (fastify: FastifyInstance, path: string): void => {

    const fileLogRoot = process.env['LOG_ROOT_DIR'] ?? process.cwd();
    const recordingS3Bucket = process.env['RECORDING_S3_BUCKET'] ?? null;

    fastify.log.info(`LocalLogRootDir: ${fileLogRoot}`);
    fastify.log.info(`Recording S3 bucket: ${recordingS3Bucket ?? '<none>'}`);
    
    const recordingBucket: RecordingBucket | null = recordingS3Bucket ? {
        service: new S3Client({}),
        name: recordingS3Bucket
    } : null;

    // Showcase two different approaches for authentication:
    // request - Verify signature in GET request that establishes WebSocket
    // session - Use authenticator handler attached to session after WebSocket is open
    const authStrategy: AuthStrategy = (process.env['SESSION_AUTH_STRATEGY'] === 'request') ? 'request' : 'session';
    
    fastify.get<{      
        Headers: {
            'audiohook-session-id'?: string;
            'audiohook-organization-id'?: string;
            'audiohook-correlation-id'?: string;
            'x-api-key'?: string;
            'signature'?: string;
            'signature-input'?: string;
        }
    }>(path, {
        websocket: true,
        onRequest: async (request, reply): Promise<unknown> => {
            request.authenticated = false;
            if(authStrategy === 'request') {
                const result = await verifyRequestSignature({ request });
                if(result.code !== 'VERIFIED') {
                    // Verification failed
                    request.log.info(`Signature verification failure: ${JSON.stringify(result)}`);
                    reply.code(401);
                    return reply.send('Signature verification failed');
                }
                request.authenticated = true;
            }
            return;
        },
        
    }, (connection, request) => {

        request.log.info(`Websocket Request - URI: <${request.url}>, SocketRemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);

        const sessionId = httpsig.queryCanonicalizedHeaderField(request.headers, 'audiohook-session-id');
        if(!sessionId || !isUuid(sessionId)) {
            throw new RangeError('Missing or invalid "audiohook-session-id" header field');
        }
        if(isDev && (connection.socket.binaryType !== 'nodebuffer')) {
            throw new Error(`WebSocket binary type '${connection.socket.binaryType}' not supported`);
        }

        const logLevel = isDev ? 'debug' : 'info';

        const logger = request.log.child({ session: sessionId }, { level: logLevel });
        
        // Create a proxy for the WebSocket that tracks statistics
        const ws = new SessionWebsocketStatsTracker(connection.socket);

        let session: ServerSession;
        if(recordingBucket) {
            // We have an S3 bucket. Create a session whose audio is recorded into a WAV file and protocol
            // and log messages are written to a sidecar JSON file, then uploaded to S3.
            const recorder = RecordedSession.create({
                ws,
                sessionId,
                requestHeader: request.headers,
                requestUri: request.url,
                outerLogger: logger,
                outerLogLevel: logLevel,
                filePathRoot: fileLogRoot,
                recordingBucket
            });
            logger.info(`Session created. Logging sidecar file: ${recorder.sidecar.filepath}`);
            session = recorder.session;
        } else {
            // No S3 bucket configured, just create a server session
            session = createServerSession({
                ws,
                id: sessionId,
                logger
            });
        }
        
        if(!(request.authenticated ?? false)) {
            // Request has not yet been authenticated, attach authenticator(s) to verify request signature.
            initiateRequestAuthentication({ session, request });
        }

        // Add agent assist handler (enabled through "customConfig" parameter in open message)
        addAgentAssist(session);

        const lifecycleToken = fastify.lifecycle.registerSession(() => {
            logger.info('Service shutdown announced, trigger reconnect');
            // session.reconnect();
        });

        session.addFiniHandler(() => {
            lifecycleToken.unregister();
        });

        // Register handler for statistics tracking proxy and fini handler to log session statistics
        session.addOpenHandler(ws.createTrackingHandler());
        session.addFiniHandler(() => {
            fastify.log.info({ session: sessionId }, `Session statistics - ${ws.loggableSummary()}`);
        });
    });
};
