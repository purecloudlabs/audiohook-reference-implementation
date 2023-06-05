import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
    SecretsManagerClient,
    GetSecretValueCommand,
    SecretsManagerClientConfig,
} from '@aws-sdk/client-secrets-manager';
import {
    isJsonObject,
    isString,
} from '../audiohook';


export interface Secrets {
    lookupSecretForKeyId(keyId: string): Promise<Uint8Array | null>;
}

declare module 'fastify' {
    interface FastifyInstance {
        secrets: Secrets;
    }
}

export type SecretsPluginOptions = SecretsManagerClientConfig;


type KeyToSecretMap = Map<string, Uint8Array | null>;

class SecretsCache implements Secrets {
    private staticSecrets: KeyToSecretMap = new Map();
    private dynamicSecrets: KeyToSecretMap = new Map();
    private secretsClient: {
        nameOrArn: string;
        client: SecretsManagerClient;
        lastFetchTimestamp: number;
    } | null;

    private constructor(options: SecretsPluginOptions) {
        const secretNameOrArn = process.env['SECRET_NAME_OR_ARN'] ?? null;
        this.secretsClient = secretNameOrArn ? {
            nameOrArn: secretNameOrArn,
            client: new SecretsManagerClient(options),
            lastFetchTimestamp: 0,
        } : null;
        const secretValues = process.env['STATIC_API_KEY_MAP'];
        if(secretValues) {
            this.staticSecrets = SecretsCache._parseSecretValues(secretValues);
        }
    }

    static async create(options: SecretsPluginOptions) {
        const res = new SecretsCache(options);
        await res._fetchDynamicSecrets();
        return res;
    }

    async lookupSecretForKeyId(keyId: string): Promise<Uint8Array | null> {
        let secret = null;
        if(this.secretsClient) {
            const now = Date.now();
            const age = now - this.secretsClient.lastFetchTimestamp;
            secret = this.dynamicSecrets.get(keyId);
            if(age >= (secret ? 5*60*1000 : 60*1000)) {
                // If we already know the secret, we check at most once every 5 minutes whether it's still valid (i.e. refresh)
                // If it's an unknown secret, we query Secret Manager at most once a minute to avoid excessive cost when hit with flood of requests
                await this._fetchDynamicSecrets();
                secret = this.dynamicSecrets.get(keyId);
            }
        }
        return secret ?? this.staticSecrets.get(keyId) ?? null;
    }

    private async _fetchDynamicSecrets(): Promise<void> {
        if(this.secretsClient) {
            const command = new GetSecretValueCommand({ SecretId: this.secretsClient.nameOrArn });
            const response = await this.secretsClient.client.send(command);
            const str = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString('utf-8') : '{}');
            this.dynamicSecrets = SecretsCache._parseSecretValues(str);
        }
    }

    private static _parseSecretValues(src: string) {
        const res = new Map();
        const json = JSON.parse(src);
        if(!isJsonObject(json)) {
            throw new Error('Secret value must be JSON object');
        }
        Object.entries(json).forEach(([keyId, value]) => {
            if(isString(value)) {
                res.set(keyId, value.length === 0 ? new Uint8Array() : Buffer.from(value, 'base64'));
            } else if (value === null) {
                res.set(keyId, new Uint8Array());
            } else {
                throw new Error(`Value of secret item '${keyId}' is type ${typeof value}, must be string or null`);
            }
        });
        return res;
    }
}


const secretsPlugin: FastifyPluginAsync<SecretsPluginOptions> = async (fastify, options) => {
    const secrets = await SecretsCache.create(options);
    fastify.decorate<FastifyInstance['secrets']>('secrets', secrets);
};

export default fp(secretsPlugin, {
    fastify: '4.x',
    name: 'secrets'
});
