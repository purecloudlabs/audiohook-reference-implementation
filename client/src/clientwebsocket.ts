import { URL } from 'url';
import { WebSocket } from 'ws';
import { ClientWebSocketFactory, httpsignature } from '../../app/audiohook';

export const createClientWebSocket: ClientWebSocketFactory = ({
    uri, 
    organizationId, 
    sessionId, 
    correlationId, 
    authInfo,
    logger,
}) => {
    const url = new URL(uri);
    const signatureHeaders = authInfo.clientSecret ? (
        new httpsignature.SignatureBuilder()
            .addComponent('@request-target', url.pathname + url.search)
            .addComponent('@authority', url.host)   // Note: host is normalized (excludes default port even if specified in source)
            .addComponent('audiohook-organization-id', organizationId)
            .addComponent('audiohook-session-id', sessionId)
            .addComponent('audiohook-correlation-id', correlationId)
            .addComponent('x-api-key', authInfo.apiKey)
            .createSignature({
                keyid: authInfo.apiKey,
                key: authInfo.clientSecret
            })
    ) : null;
    const requestHeaders = {
        'Audiohook-Organization-Id': organizationId,
        'Audiohook-Session-Id': sessionId,
        'Audiohook-Correlation-Id': correlationId,
        'X-API-KEY': authInfo.apiKey,
        ...signatureHeaders
    };
    logger.info(`Request headers: ${JSON.stringify(requestHeaders, null, 1)}`);

    return new WebSocket(
        uri,
        {
            followRedirects: false,
            headers: requestHeaders
        }
    );
};

