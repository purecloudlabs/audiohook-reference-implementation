import {
    OpenHandler,
    ServerSession as Session,
    MediaSelector,
    MediaChannel,
    StreamDuration,
    EventEntityAgentAssist,
    normalizeError
} from '../audiohook';
import { v4 as uuid } from 'uuid';


const guessTextSpeechDuration = (text: string): StreamDuration => {
    // Assume average 130 words per minute and 6.5 characters per word plus space/punctuation for English.
    const charsPerSecond = 130 * (6.5 + 1) / 60;
    return StreamDuration.fromSeconds(Math.round(100*text.trim().length/charsPerSecond)/100);
};

const sendUtteranceEntity = (session: Session, text: string, channel: MediaChannel, isFinal?: boolean): void => {
    const start = StreamDuration.fromSeconds(Math.max(0, session.position.seconds - 1.5));
    const entity: EventEntityAgentAssist = {
        type: 'agentassist',
        data: {
            id: uuid(),
            utterances: [
                {
                    id: uuid(),
                    position: start.asDuration(),
                    duration: guessTextSpeechDuration(text).asDuration(),
                    text,
                    confidence: 0.85,
                    language: 'en-US',
                    channel,
                    isFinal: isFinal ?? true
                }
            ]
        }
    };
    session.sendEvent([entity]);
};

const sendSuggestionFaq = (session: Session, utterance: string, question: string, answer: string): void => {
    const uttStart = StreamDuration.fromSeconds(Math.max(0, session.position.seconds - 3.2));
    const entity: EventEntityAgentAssist = {
        type: 'agentassist',
        data: {
            id: uuid(),
            utterances: [
                {
                    id: uuid(),
                    position: uttStart.asDuration(),
                    duration: guessTextSpeechDuration(utterance).asDuration(),
                    text: utterance,
                    confidence: 1,
                    language: 'en-US',
                    channel: 'external',
                    isFinal: true
                }   
            ],
            suggestions: [
                {
                    type: 'faq',
                    id: uuid(),
                    position: session.position.asDuration(),
                    question,
                    answer,
                    confidence: 0.93
                }   
            ]
        }
    };
    session.sendEvent([entity]);
};

const sendSuggestionArticle = (session: Session, title: string, excerpts: string[], uri: string): void => {
    const entity: EventEntityAgentAssist = {
        type: 'agentassist',
        data: {
            id: uuid(),
            suggestions: [
                {
                    type: 'article',
                    id: uuid(),
                    position: session.position.asDuration(),
                    title,
                    excerpts,
                    confidence: 0.96,
                    documentUri: uri
                }   
            ]
        }
    };
    session.sendEvent([entity]);
};


const agentAssistOpenHandler:OpenHandler = ({ session }) => {
    let frameCount = 0;
    const audioHandler = (): void => {
        ++frameCount;
    };
    session.on('audio', audioHandler);

    let sequenceIndex = 0;

    const sequenceHandler = () => {
        try {
            ++sequenceIndex;
            if(sequenceIndex === 1) {
                sendUtteranceEntity(
                    session, 
                    'Welcome to ACME. How can I be of assistance?', 
                    'internal'
                );
            } else if((sequenceIndex % 3) === 0) {
                sendSuggestionFaq(
                    session, 
                    'I\'m curious. You received a lot of audio frames from me. Do you know how many?',
                    'How many frames have your received?', 
                    `We received ${frameCount} audio frames so far this session.`,
                );
            } else if((sequenceIndex % 3) === 1) {
                sendUtteranceEntity(
                    session, 
                    'Is there anything I can help you with?', 
                    'internal'
                );
            } else {
                sendSuggestionArticle(
                    session,
                    'Conversations Overview',
                    ['A Genesys Cloud conversation is an interaction between multiple participants over at least one media channel such as chat, phone, or email.'],
                    'https://developer.genesys.cloud/api/rest/v2/conversations/overview'
                );
            }
        } catch(err) {
            session.disconnect(normalizeError(err));
        }
    };

    let intervalTimer: NodeJS.Timeout | null;
    let delayTimer: NodeJS.Timeout | null = setTimeout(() => {
        sequenceHandler();
        delayTimer = null;
        intervalTimer = setInterval(sequenceHandler, 12345);
    }, 3000);

    return () => {
        session.off('audio', audioHandler);
        if(delayTimer) {
            clearTimeout(delayTimer);
        }
        if(intervalTimer) {
            clearInterval(intervalTimer);
        }
    };
};


const agentAssistMediaSelector: MediaSelector = (session, offered, openParams) => {
    const agentassist = openParams.customConfig?.['agentassist'];
    if(!agentassist) {
        return offered;
    }
    const stereo = offered.filter(media => (media.channels.length === 2));
    if (stereo.length === 0) {
        session.disconnect('error', 'No matching media format offered. Agent Assist needs two channels!');
    }
    session.addOpenHandler(agentAssistOpenHandler);
    return stereo;
};


export const addAgentAssist = (session: Session) => {
    session.addMediaSelector(agentAssistMediaSelector);
};
