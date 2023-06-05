import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';


declare module 'fastify' {
    interface FastifyInstance {
        dynamodb: DynamoDBClient;
    }
}

export type DynamodbPluginOptions = DynamoDBClientConfig;

const dynamodbPlugin: FastifyPluginAsync<DynamodbPluginOptions> = async (fastify, options) => {
    const dynamodb =  new DynamoDBClient(options); 
    fastify.decorate<FastifyInstance['dynamodb']>('dynamodb', dynamodb);
};

export default fp(dynamodbPlugin, {
    fastify: '4.x',
    name: 'dynamodb'
});
