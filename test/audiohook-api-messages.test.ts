import { v4 as uuid } from 'uuid';
import { createClientForAudiohook, 
    createClientForTranscriptConnector, 
    waitForPong, 
    clientPingMessage, 
    clientErrorMessage, 
    clientCloseMessage, 
    clientUpdateMessage, 
    clientDiscardingMessage, 
    TestOpenParams, 
    validateMediaParams, 
    getFromConfig, 
    commonValidations, 
    delay, 
    clientPauseMessage, 
    clientResumeMessage, 
    transcriptValidations, 
    waitForClosed
} from './api-test-utils';
import { ClientSession } from '../app/audiohook';
import { MediaChannels, MediaParameters } from '../app/audiohook';
import { expect } from '@jest/globals';
import './toBeEqualTo';
import './supportedLanguagesToBe';
import { 
    transcript_info,
    transcript_info_longer,
    delta,
} from './test-data';
import {
    JsonObject
} from '../app/audiohook';

import ConfigParser from 'configparser';

const SECONDS = 1000;

describe('API Messages', () => {
    // sets up constant values to use for the tests
    let client: ClientSession;
    let id: string;
    const config = new ConfigParser();
    config.read('./testconfig.cfg');
    config.sections();
    const orgId = uuid(); // same organization ID for all tests
    const startLanguage: string = config.get('OpenParameters', 'language') ?? 'en-US';
    const customConfig: JsonObject = JSON.parse(config.get('OpenParameters', 'customConfig') ?? '{}');
    const isSingleChannel: boolean = config.get('Features', 'singleChannel') === 'true';
    const isDoubleChannel: boolean = config.get('Features', 'doubleChannel') === 'true';
    const isTranscriptConnected: boolean = config.get('Features', 'transcriptionConnector') === 'true';
    const openParam = (id: string, supportLanguages: boolean): TestOpenParams => {
        return {
            sessionId: id,
            language: startLanguage,
            customConfig: customConfig,
            supportedLanguages: supportLanguages
        };
    };
    const openParamsCustom = (id: string, customMedia: MediaParameters): TestOpenParams => {
        return {
            sessionId: id,
            media: customMedia,
            language: startLanguage,
            customConfig: customConfig,
            supportedLanguages: false
        };
    };      

    // Get the server uri, api key and client secret from the environment variables
    beforeAll(() => {
        getFromConfig();
    });

    // New message id for each test case
    beforeEach(() => {
        id = uuid();
    });

    afterEach(async () => {
        await clientCloseMessage();
    });
    
    const singleChannelTest = () => isSingleChannel? it : it.skip;
    const doubleChannelTest = () => isDoubleChannel? it : it.skip;
    const transcriptConnectorTest = () => isTranscriptConnected? it : it.skip;
    

    
    //===========================================================================================================================//
    //================================================== Open Message Tests =====================================================//
    //===========================================================================================================================//

    doubleChannelTest() ('Open Message - Test Double Stream Double Channel', async () => {
        //===========================================================================================================================//
        // validate that the media format selected by the server is exactly [['external', 'internal'], ['external'], ['internal']]
        // and that the server has not modified the offered format.
        //===========================================================================================================================//

        const channels: MediaChannels[] = [['external', 'internal'], ['external'], ['internal']];
        const customMedia: MediaParameters = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: 8000 }));
        
        // params for the open message
        const openParams: TestOpenParams = openParamsCustom(id, customMedia);
        client = await createClientForAudiohook(orgId, openParams);
        
        // Validations
        const msg = client.openedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'opened');
        validateMediaParams(customMedia, msg?.parameters.media);
    });

    doubleChannelTest() ('Open Message - Test Double Stream Double Channel Inverted', async () => {
        //===========================================================================================================================//
        // validate that the media format selected by the server is exactly [['internal', 'external'], ['internal'], ['external']]
        // and that the server has not modified the offered format.
        //===========================================================================================================================//

        const channels: MediaChannels[] = [['internal', 'external'], ['internal'], ['external']];
        const customMedia: MediaParameters = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: 8000 }));

        // params for the open message
        const openParams: TestOpenParams = openParamsCustom(id, customMedia);
        client = await createClientForAudiohook(orgId, openParams);
        
        // Validations
        const msg = client.openedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'opened');
        validateMediaParams(customMedia, msg?.parameters.media);
    });



    doubleChannelTest() ('Open Message - Test Single Stream Double Channel', async () => {
        //===========================================================================================================================//
        // validate that the media format selected by the server is exactly [['external', 'internal']]
        // and that the server has not modified the offered format.
        //===========================================================================================================================//

        const channels: MediaChannels[] = [['external', 'internal']];
        const customMedia: MediaParameters = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: 8000 }));

        // params for the open message
        const openParams: TestOpenParams = openParamsCustom(id, customMedia);
        client = await createClientForAudiohook(orgId, openParams);
        
        // Validations
        const msg = client.openedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'opened');
        validateMediaParams(customMedia, msg?.parameters.media);
    });
    
    
    singleChannelTest() ('Open Message - Test Single Stream Single Channel External', async () => {
        //===========================================================================================================================//
        // validate that the media format selected by the server is exactly [['external']]
        // and that the server has not modified the offered format.
        //===========================================================================================================================//

        const channels: MediaChannels[] = [['external']];
        const customMedia: MediaParameters = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: 8000 }));

        // params for the open message
        const openParams: TestOpenParams = openParamsCustom(id, customMedia);
        client = await createClientForAudiohook(orgId, openParams);
        
        // Validations
        const msg = client.openedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'opened');
        validateMediaParams(customMedia, msg?.parameters.media);
    });


    singleChannelTest() ('Open Message - Test Single Stream Single Channel Internal', async () => {
        //===========================================================================================================================//
        // validate that the media format selected by the server is exactly [['internal']]
        // and that the server has not modified the offered format.
        //===========================================================================================================================//

        const channels: MediaChannels[] = [['internal']];
        const customMedia: MediaParameters = channels.map(channels => ({ type: 'audio', format: 'PCMU', channels, rate: 8000 }));
        // params for the open message
        const openParams: TestOpenParams = openParamsCustom(id, customMedia);
        client = await createClientForAudiohook(orgId, openParams);
        
        // Validations
        const msg = client.openedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'opened');
        validateMediaParams(customMedia, msg?.parameters.media);
    });

    
    
    //===========================================================================================================================//
    //=================================================== Audiohook Monitor =====================================================//
    //===========================================================================================================================//

    test ('Audiohook Monitor - Ping Pong', async () => {
        //===========================================================================================================================//
        // Send a Ping and wait for a Pong, and check for the sequence numbers. 
        // The client will store the first ping message, and the first pong message, which we assert below.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientPingMessage();
        await waitForPong(client);
        await clientCloseMessage();
        
        // Validations
        const pingMsg = client.pingMsg;
        const pongMsg = client.pongMsg;
        expect(pingMsg?.seq).seqNumberToBe('Ping Seq', 2);
        expect(pingMsg?.serverseq).seqNumberToBe('Ping Serverseq', 1);
        expect(pongMsg?.seq).seqNumberToBe('Pong Seq', 2);
        expect(pongMsg?.clientseq).seqNumberToBe('Pont Clientseq', 2);
    }, 7 * SECONDS);

    test ('Audiohook Monitor - Ping Pong Close', async () => {
        //===========================================================================================================================//
        // Send a Ping and wait for a Pong, and check for the sequence numbers. 
        // The client will store the first ping message, and the first pong message, which we assert below.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientPingMessage();
        await clientCloseMessage();

        // Validations
        const pingMsg = client.pingMsg;
        const pongMsg = client.pongMsg;
        expect(pingMsg?.seq).seqNumberToBe('Ping Seq', 2);
        expect(pingMsg?.serverseq).seqNumberToBe('Ping Serverseq', 1);
        expect(pongMsg?.seq).seqNumberToBe('Pong Seq', 2);
        expect(pongMsg?.clientseq).seqNumberToBe('Pont Clientseq', 2);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });

    test ('Audiohook Monitor - Send Update Message', async () => {
        //===========================================================================================================================//
        // Send a Ping and a close immediately after. Wait for a Pong, and check for the sequence numbers. 
        // The client will store the first ping message, and the first pong message, which we assert below.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientUpdateMessage(startLanguage);
        await clientCloseMessage();
        
        // Validations
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });

    test ('Audiohook Monitor - Send Discarded Message', async () => {
        //===========================================================================================================================//
        // Send a discarded message and wait for the closed message.
        // The client will store and assert the closed message here.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientDiscardingMessage('PT6.3S', 'PT0.3S');
        await clientCloseMessage();
        // Validations
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });
    
    test ('Audiohook Monitor - Send Error Message', async () => {
        //===========================================================================================================================//
        // Send an error message and wait for the closed message.
        // The client will store and assert the closed message here.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientErrorMessage();
        await clientCloseMessage();
       
        // Validations
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });

    test ('Audiohook Monitor - Send Pause & Resume Message', async () => {
        //===========================================================================================================================//
        // Send a paused and resumed message, and wait for the closed message.
        // The client will store the closed message and assert it to make sure the sequence numbers are correct after pause & resume.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientPauseMessage();
        await delay(10000);
        await clientResumeMessage(client.pausedMsg?.position ?? 'PT0S', 'PT10S');
        await clientCloseMessage();

        // Validations
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS); 
    


    //===========================================================================================================================//
    //================================================ Transcript Connector =====================================================//
    //===========================================================================================================================//
    
    transcriptConnectorTest() ('Transcript Connector - Supported Languages', async () => {
        //===========================================================================================================================//
        // Request the list of supported languages.
        // Assert that the server's opened message has the list and asserts that they are valid.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,true);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await clientCloseMessage();

        // Validations
        expect(Array.isArray(client.openedMsg?.parameters.supportedLanguages)).toBeEqualTo('if supportedLanguages in the openedMsg is an Array',true);
        client.openedMsg?.parameters.supportedLanguages?.forEach(function(value, index){
            expect(value).supportedLanguagesToBe(index);
        });
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });
    
    transcriptConnectorTest() ('Transcript Connector - Test Events', async () => {
        //===========================================================================================================================//
        // Send a paused and resumed message, and wait for the closed message.
        // The client will store the closed message and assert it to make sure the sequence numbers are correct after pause & resume.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS); 

    transcriptConnectorTest() ('Transcript Connector - Test Update During Utterance', async () => {
        //===========================================================================================================================//
        // Send an update message during a silent part of the .wav file.
        // The client collects each event and assert that it is split, and that 
        // the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(8000);
        await clientUpdateMessage(startLanguage);
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info_longer, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS);
    
    transcriptConnectorTest() ('Transcript Connector - Test Update During Silence', async () => {
        //===========================================================================================================================//
        // Send an update message during a silent part of the .wav file.
        // The client collects each event and assert that it is not split, and that 
        // the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(6300);
        await clientUpdateMessage(startLanguage);
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS); 
   
    transcriptConnectorTest() ('Transcript Connector - Test Discard During Utterance', async () => {
        //===========================================================================================================================//
        // Send a discarded during an utterance period in the .wav file.
        // The client collects each event and assert the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(8000);
        await clientDiscardingMessage('PT8.0S', 'PT0.5S');
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS);
   
    transcriptConnectorTest() ('Transcript Connector - Test Discard During Silence', async () => {
        //===========================================================================================================================//
        // Send a discarded during a silent period in the .wav file.
        // The client collects each event and assert the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(6300);
        await clientDiscardingMessage('PT6.3S', 'PT0.3S');
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 13 * SECONDS);  
     
    transcriptConnectorTest() ('Transcript Connector - Test Pause & Resume During Utterance', async () => {
        //===========================================================================================================================//
        // Send a paused and resume during an utterance period in the .wav file.
        // The client collects each event and assert that part is split in two, and 
        // the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(8000);
        await clientPauseMessage();
        await delay(10000);
        await clientResumeMessage(client.pausedMsg?.position ?? 'PT8S', 'PT10S');
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info_longer, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 23 * SECONDS);
    
    transcriptConnectorTest() ('Transcript Connector - Test Pause & Resume During Silence', async () => {
        //===========================================================================================================================//
        // Send a paused and resume during a silent period in the .wav file.
        // The client collects each event and assert the offsets and durations are within a time window to what is expected.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForTranscriptConnector(orgId, openParams);
        await delay(6100);
        await clientPauseMessage();
        await delay(10000);
        await clientResumeMessage(client.pausedMsg?.position ?? 'PT6.1S', 'PT10S');
        await waitForClosed(client);

        // Validations
        expect(client.transcripts.length).not.toBeEqualTo('number of transcripts', 0);
        transcriptValidations(client, transcript_info, delta);
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    }, 23 * SECONDS); 


    //===========================================================================================================================//
    //====================================================== Close Message ======================================================//
    //===========================================================================================================================//
    
    test('Close Message', async () => {
        //===========================================================================================================================//
        // The client collects the closed message, which we assert here.
        //===========================================================================================================================//

        // params for the open message
        const openParams: TestOpenParams = openParam(id,false);
        client = await createClientForAudiohook(orgId, openParams);
        await clientCloseMessage();

        // Validations
        const msg = client.closedMsg;
        commonValidations(msg, client, id);
        expect(msg?.type).toBeEqualTo('Server Message\'s Type', 'closed');
    });  
});