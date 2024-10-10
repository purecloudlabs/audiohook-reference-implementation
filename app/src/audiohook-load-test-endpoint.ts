import { FastifyInstance } from 'fastify';
import { 
    createServerSession, 
    defaultTimeProvider,
    httpsignature as httpsig,
    isNullUuid,
    isUuid,
} from '../audiohook';
import { SessionWebsocketStatsTracker } from './session-websocket-stats-tracker';
import { createTestStatusDataItem } from './datamodel-teststatus';

const timeProvider = defaultTimeProvider;

export const addAudiohookLoadTestRoute = (fastify: FastifyInstance, path: string): void => {

    fastify.get(path, { websocket: true }, (connection, request) => {

        const sessionId = httpsig.queryCanonicalizedHeaderField(request.headers, 'audiohook-session-id');
        if(!sessionId || !isUuid(sessionId)) {
            throw new RangeError(`Missing or invalid "audiohook-session-id" header field. RemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);
        }
        const orgId = httpsig.queryCanonicalizedHeaderField(request.headers, 'audiohook-organization-id');
        if(!orgId || !isUuid(orgId)) {
            throw new RangeError(`Missing or invalid "audiohook-organization-id" header field. RemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);
        }
        const correlationId = httpsig.queryCanonicalizedHeaderField(request.headers, 'audiohook-correlation-id');
        if(!correlationId || !isUuid(correlationId)) {
            throw new RangeError(`Missing or invalid "audiohook-correlation-id" header field. RemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);
        }

        const logLevel = 'warn';

        const logger = fastify.log.child({ session: sessionId }, { level: logLevel });
        
        request.log.debug(`Websocket Request - URI: <${request.url}>, SocketRemoteAddr: ${request.socket.remoteAddress}, Headers: ${JSON.stringify(request.headers, null, 1)}`);
        
        const ws = new SessionWebsocketStatsTracker(connection.socket);

        const session = createServerSession({
            ws,
            id: sessionId,
            logger,
            timeProvider
        });

        session.addOpenHandler(async ({ openParams }) => {
            const conversationId = openParams.conversationId;
            const participantId = openParams.participant.id;
            if(isNullUuid(conversationId) || isNullUuid(participantId)) {
                // Connection probes are not saved to DynamoDB
                return;
            }
            const testStatus = await createTestStatusDataItem(request.server.dynamodb, {
                sessionId,
                orgId,
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

        const lifecycleToken = fastify.lifecycle.registerSession(() => {
            logger.info('Service shutdown announced, trigger reconnect');
            // session.reconnect();
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
