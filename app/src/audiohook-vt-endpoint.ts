import { FastifyInstance } from 'fastify';
import dotenv from 'dotenv';
import { SessionWebsocketStatsTracker } from './session-websocket-stats-tracker';
import { createAudioHookSession } from './create-audiohook-session';
import { initiateRequestAuthentication } from './authenticator';
import { SimulatedTranscripts, VTSupportedLanguages } from './sim-transcribe/simulated-transcripts';
import { isNullUuid } from '../audiohook';
import { createTestStatusDataItem } from './datamodel-teststatus';

dotenv.config();

export const addAudiohookVoiceTranscriptionRoute = (fastify: FastifyInstance, path: string): void => {

    const fileLogRoot = process.env['LOG_ROOT_DIR'] || process.cwd();

    fastify.log.info(`LocalLogRootDir: ${fileLogRoot}`);

    fastify.get<{
        Querystring: {
            session?: string;
        },
        Headers: {
            'audiohook-session-id'?: string;
            'audiohook-organization-id'?: string;
            'audiohook-correlation-id'?: string;
            'x-api-key'?: string;
            'signature'?: string;
            'signature-input'?: string;
        }
    }>(path, {
        websocket: true
    }, (connection, request) => {

        request.log.info(`Websocket Request - URI: <${request.url}>, SocketRemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);

        const ws = new SessionWebsocketStatsTracker(connection.socket);

        const { session, sessionId, organizationId, correlationId } = createAudioHookSession({ request, connection, ws, supportedLanguages: VTSupportedLanguages });

        if(!(request.authenticated ?? false)) {
            // Request has not yet been authenticated, attach authenticator(s) to verify request signature.
            initiateRequestAuthentication({ session, request });
        }

        session.addOpenHandler(async ({ openParams }) => {
            const conversationId = openParams.conversationId;
            const participantId = openParams.participant.id;
            if(isNullUuid(conversationId) || isNullUuid(participantId)) {
                // Connection probes are not saved to DynamoDB
                return;
            }
            const testStatus = await createTestStatusDataItem(request.server.dynamodb, {
                sessionId,
                orgId: organizationId,
                correlationId,
                conversationId,
                position: session.position,
                openParams
            });
            if(!testStatus) {
                return;
            }

            return async (session, closeParams) => {
                return async () => {
                    const result = {
                        reason: closeParams?.reason ?? 'unknown',
                        statistics: ws.jsonSummary()
                    };
                    await testStatus.finalize(session.position, 'finalized', result);
                };
            };
        });

        const simulatedTranscripts = new SimulatedTranscripts(session);

        const lifecycleToken = fastify.lifecycle.registerSession(() => {
            session.logger.info('Service shutdown announced, trigger reconnect');
        });
        session.addFiniHandler(() => {
            lifecycleToken.unregister();
        });

        session.addOpenHandler(ws.createTrackingHandler());

        session.addFiniHandler(() => {
            fastify.log.info({ session: sessionId }, `Statistics: ${ws.loggableSummary()}`);
        });
    });
};
