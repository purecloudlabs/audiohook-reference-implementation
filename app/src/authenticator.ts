import { randomBytes } from 'crypto';
import { FastifyRequest } from 'fastify';
import {
    Logger,
    ServerSession as Session,
} from '../audiohook';
import {
    VerifyResult,
    verifySignature,
    withFailure,
    queryCanonicalizedHeaderField
} from '../audiohook/httpsignature';

//
// **** WARNING - WARNING - WARNING *****
// 
// The code in this file showcases how you can secure access to your AudioHook server resources through signature verification.
// Make sure you understand how this all works before changing the code. Please verify that the access control performs as intended. 
// Ask for guidance if you are not sure.
//
// **** WARNING - WARNING - WARNING *****
// 


// Minimum response delay on signature failure to reduce risk of timing leaks.
const defaultMinDelayResponseOnFailureMs = 500;

export type VerifyRequestSignatureParams = {
    request: FastifyRequest;
    logger?: Logger;
    minFailureDuration?: number;
};

export const verifyRequestSignature = async (params: VerifyRequestSignatureParams): Promise<VerifyResult> => {
    const startTime = Date.now();
    const result = await verifyRequestSignatureAux(params);
    if(result.code !== 'VERIFIED') {
        // The signature verification failed. Let's delay the response so failures are signaled a fixed 
        // amount of time after the start of the signature verification to reduce the risk of timing side channel.
        const minDuration = params.minFailureDuration ?? defaultMinDelayResponseOnFailureMs; 
        const delay = startTime + minDuration - Date.now();
        if(delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return result;
};


const verifyRequestSignatureAux = async ({ request, logger }: VerifyRequestSignatureParams): Promise<VerifyResult> => {

    const apiKey = queryCanonicalizedHeaderField(request.headers, 'x-api-key');
    if(!apiKey) {
        return withFailure('PRECONDITION', 'Missing "X-API-KEY" header field');
    }

    const result = await verifySignature({
        headerFields: request.headers,
        requiredComponents: [
            '@request-target',
            '@authority',
            'audiohook-organization-id',
            'audiohook-session-id',
            'audiohook-correlation-id',
            'x-api-key'
        ],
        maxSignatureAge: 10,
        derivedComponentLookup: (name) => {
            if (name === '@request-target') {
                return request.url ?? null;
            }
            return null;
        },
        keyResolver: async (parameters) => {

            logger?.debug(`Signature Parameters: ${JSON.stringify(parameters)}`);
            if (!parameters.nonce) {
                return withFailure('PRECONDITION', 'Missing "nonce" signature parameter');
            } else if (parameters.nonce.length < 22) {
                return withFailure('PRECONDITION', 'Provided "nonce" signature parameter is too small');
            }

            const keyId = parameters.keyid;
            if(keyId !== apiKey) {
                return withFailure('PRECONDITION', 'X-API-KEY header field and signature keyid mismatch');
            }
            const secret = await request.server.secrets.lookupSecretForKeyId(keyId);
            if(secret) {
                // Note: if no secret is defined for the key but the request is signed, we get here with an Uint8Array of length 0.
                // The signature check will then fail as the key is wrong. Technically, it means we verify the signature with a
                // client secret of all zeroes. The way HMAC-SHA256 does the key padding, trailing zeroes up to block size (64 bytes) 
                // are irrelevant. An empty client secret value ('') is therefor the same as a client secret value in the range
                // 'AA==' to 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='.
                return {
                    code: 'GOODKEY',
                    key: secret
                };
            } else {
                // Unknown API key, perform signature check with dummy random key and forced failure.
                logger?.debug(`Unknown API key: ${keyId}`);
                return {
                    code: 'BADKEY',
                    key: randomBytes(32)
                };
            }
        }
    });

    if(result.code === 'UNSIGNED') {
        // We allow unsigned requests, but the API key must be valid and reference an empty client secret
        const secret = await request.server.secrets.lookupSecretForKeyId(apiKey);
        if(secret && (secret.length === 0)) {
            return { code: 'VERIFIED' };
        }
    }
    return result;
};


export type FailureSignalingMode = 'immediate' | 'open';

export type InitiateRequestAuthenticationParams = {
    session: Session;
    request: FastifyRequest;
    failureSignalingMode?: FailureSignalingMode;
    minFailureDuration?: number;
};

export const initiateRequestAuthentication = ({ session, request, failureSignalingMode, minFailureDuration }: InitiateRequestAuthenticationParams): void => {

    // Add an authenticator that checks that the orgid in the header matches the parameter in the open message.
    session.addAuthenticator(
        async (session, openParams) => {
            const organizationId = queryCanonicalizedHeaderField(request.headers, 'audiohook-organization-id');
            if(!organizationId) {
                session.logger.warn('No "audiohook-organization-id" header field');
                return 'Missing "audiohook-organization-id" header field';

            } else if(openParams.organizationId !== organizationId) {
                session.logger.warn(`Organization ID mismatch! Header field: ${organizationId}, 'open' message: ${openParams.organizationId}`);
                return 'Mismatch between "organizationId" open parameter and "audiohook-organization-id" header field';
            }
            return true;
        }
    );

    // Initiate the signature verification asynchronously and attach an authentication handler for it.
    // The authentication handler will then wait until the signature verification has completed 
    // (if the promise hasn't resolved by the time the 'open' message arrives).
    //
    // We have two options on how to signal the failure:
    //  1) Wait until the open message arrives and then signal the disconnect in its context.
    //  2) Immediately signal as part of the the verification completing (after delay).
    //
    // In practice, the client will initiate the open transaction in less than the failure delay, so there is 
    // not really much of a difference. Signaling immediately is maybe slightly preferred.

    const signalingMode = failureSignalingMode ?? 'immediate';

    const resultPromise = (
        verifyRequestSignature({
            request, 
            logger: session.logger,
            minFailureDuration
        }).then(result => {
            session.logger.info(`Signature verification resolved: ${JSON.stringify(result)}`);
            if (result.code === 'VERIFIED') {
                // Verification successful. Signal to next in chain.
                return result;
            } else if(signalingMode === 'immediate') {
                // Signal failure immediately (don't wait for open transaction)
                // IMPORTANT-TODO: Probably too much information included for production use!!!
                session.disconnect('unauthorized', result.reason ? `${result.code}: ${result.reason}` : result.code);
            }
            return result;
        })
    );

    session.addAuthenticator(async (session) => {

        // Note: We might not get here in the 'immediate' signalingMode mode. If the client got the message before it sent 
        // the open message, it won't do an open transaction. If the disconnect raced the open message (server in 'UNAUTHORIZED' state), 
        // the server will ignore the open message, expecting a close transaction imminently.

        const result = await resultPromise;
        session.logger.debug(`Authenticator - Signature verification result: ${JSON.stringify(result)}`);
        
        if(result.code !== 'VERIFIED') {
            // IMPORTANT-TODO: Probably too much information included for production use!!!
            return result.reason ? `${result.code}: ${result.reason}` : result.code;
        } else {
            return true;
        }
    });  
};

