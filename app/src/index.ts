import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import { pino } from 'pino';
import { PrettyOptions } from 'pino-pretty';
import serviceLifecylePlugin from './service-lifecycle-plugin';
import dynamodbPlugin from './dynamodb-plugin';
import secretsPlugin from './secrets-plugin';
import { addAudiohookSampleRoute } from './audiohook-sample-endpoint';
import { addAudiohookLoadTestRoute } from './audiohook-load-test-endpoint';
import { addAudiohookVoiceTranscriptionRoute } from './audiohook-vt-endpoint';

dotenv.config();

const isDev = process.env['NODE_ENV'] !== 'production';

const loggerPrettyTransport: pino.TransportSingleOptions<PrettyOptions> = {
    target: 'pino-pretty',
    options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:HH:MM:ss.l',
    }
};

const server = Fastify({
    logger: isDev ? ({ 
        transport: loggerPrettyTransport
    }) : true
});

server.register(websocket, {
    options: {
        maxPayload: 65536
    }
});



server.register(async (fastify: FastifyInstance) => {
    addAudiohookSampleRoute(fastify, '/api/v1/audiohook/ws');
    addAudiohookVoiceTranscriptionRoute(fastify, '/api/v1/voicetranscription/ws');
    addAudiohookLoadTestRoute(fastify, '/api/v1/loadtest/ws');

});


server.register(dynamodbPlugin);
server.register(secretsPlugin);
server.register(serviceLifecylePlugin);


server.listen({
    port: parseInt(process.env?.['SERVERPORT'] ?? '3000'),
    host: process.env?.['SERVERHOST'] ?? '127.0.0.1'
}).then(() => {
    server.log.info(`Routes: \n${server.printRoutes()}`);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
