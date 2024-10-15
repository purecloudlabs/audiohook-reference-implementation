import {
    OpenHandler,
    ServerSession as Session,
    MediaSelector,
    MediaDataFrame,
    CloseHandler,
    EventEntityTranscript,
    EventEntityDataTranscript,
    UpdateHandler,
    LanguageCode,
    ResumedParameters,
    StreamDuration,
    isValidLanguageCode,
    SupportedLanguages
} from '../../audiohook';
import ByteBuffer from 'bytebuffer';
import { VoiceEvent } from './voice-activity-detection/voice-event';
import { makeTranscript } from './make-transcript';
import { VoiceActivityDetector } from './voice-activity-detection/voice-activity-detection';

export const VTSupportedLanguages = [
    'en-US',
    'en-AU',
    'en-GB',
    'en-IN',
    'en-ZA',
    'fr-CA',
    'fr-FR',
    'pt-BR',
    'zh-CN',
    'cmn-CN',
    'bg-BG',
    'el-GR'
];

export const VTSupportedLanguagesLowercase = VTSupportedLanguages.map((item) => {
    return item.toLowerCase();
});

export class SimulatedTranscripts {

    private vadLeft: VoiceActivityDetector;
    private vadRight: VoiceActivityDetector;
    private vadPositionMs: StreamDuration = StreamDuration.zero;
    private language: LanguageCode;

    constructor(session: Session) {
        session.addMediaSelector(this.transcriptMediaSelector);
    }

    private transcriptMediaSelector: MediaSelector = (session, offered) => {
        const stereo = offered.filter(media => (media.channels.length === 2));
        if (stereo.length === 0) {
            session.disconnect('error', 'No matching media format offered. Voice transcription needs two channels!');
        }
        session.addOpenHandler(this.transcriptOpenHandler);
        session.addUpdateHandler(this.transcriptUpdateHandler);
        session.addCloseHandler(this.transcriptCloseHandler);
        return stereo;
    };

    private handleChannelData = (buffer: ByteBuffer, vad: VoiceActivityDetector, entities: EventEntityDataTranscript[]) => {
        const events: VoiceEvent[] = vad.detectVoiceActivity(buffer);
        events.forEach(event => {
            const transcript = makeTranscript(vad.getChannelId, event, this.language, this.vadPositionMs);
            if (transcript) {
                entities.push(transcript);
            }
        });
    };
    
    private handleChannelClose = (vad: VoiceActivityDetector, entities: EventEntityDataTranscript[]) => {
        if (vad != null) {
            const events: VoiceEvent[] = vad.notifyEndOfStream();
            events.forEach(event => {
                const transcript = makeTranscript(vad.getChannelId, event, this.language, this.vadPositionMs);
                if (transcript) {
                    entities.push(transcript);
                }
            });
        }
    };
    
    private closeAudio = (session: Session) => {
        const entities: EventEntityDataTranscript[] = [];
        if (session.selectedMedia?.channels.length == 2) {
            this.handleChannelClose(this.vadLeft, entities);
            this.handleChannelClose(this.vadRight, entities);
        } else if (session.selectedMedia?.channels.length == 1) {
            this.handleChannelClose(this.vadLeft, entities);
        } else {
            throw new Error('No Channel present');
        }
        this.sendEvent(session, entities);
    };
    
    private updateLanguage = (session: Session) => {
        if(!session.language) {
            session.logger.info('Pausing since language is not set');
            session.pause();
        } else if (!isValidLanguageCode(session.language, VTSupportedLanguagesLowercase)) {
            session.logger.info(`Pausing since language '${session.language}' is not supported: ${VTSupportedLanguages}`);
            session.pause();
        } else {
            session.logger.info(`Updating language to '${session.language}'`);
            this.language = session.language;
            this.vadPositionMs = session.position;
            this.vadLeft = new VoiceActivityDetector(0);
            this.vadRight = new VoiceActivityDetector(1);
        }
    };
    
    private transcriptOpenHandler: OpenHandler = ({ session }) => {
        const audioHandler = (frame: MediaDataFrame) => {
            if (frame.channels.length < 1) {
                throw new Error('No Channel present');
            }
    
            const channelData = new Map();
            frame.getChannelViews().forEach(channel => {
                channelData.set(channel.channelId, channel.data);
            });
    
            const entities: EventEntityDataTranscript[] = [];
            if (channelData.get(0) != null) {
                this.handleChannelData(ByteBuffer.wrap(channelData.get(0)), this.vadLeft, entities);
            }
            if (channelData.get(1) != null) {
                this.handleChannelData(ByteBuffer.wrap(channelData.get(1)), this.vadRight, entities);
            }
            this.sendEvent(session, entities);
        };

        this.updateLanguage(session);
        if (session.state != 'PAUSED') {
            session.on('audio',audioHandler);
        }
    
        const pausedHandler = () => {
            this.closeAudio(session);
            session.off('audio', audioHandler);
        };
        session.on('paused', pausedHandler);
    
        const resumedHandler = (resumedMessage: ResumedParameters) => {
            this.updateLanguage(session);
            session.on('audio', audioHandler);
        };
        session.on('resumed', resumedHandler);
    
        return () => {
            session.off('audio', audioHandler);
            session.off('paused', pausedHandler);
            session.off('resumed', resumedHandler);
        };
    };
    
    private transcriptUpdateHandler: UpdateHandler = (session) => {
        this.closeAudio(session);
        if (session.state === 'PAUSED') {
            session.logger.info('Resuming from PAUSED state since language is valid');
            session.resume();
        } else {
            this.updateLanguage(session);
        }
    };
    
    private transcriptCloseHandler: CloseHandler = (session) => {
        this.closeAudio(session);
    };
    
    private sendEvent = (session: Session, dataEntities: EventEntityDataTranscript[]) => {
        const entities: EventEntityTranscript[] = [];
        if (dataEntities.length > 0) {
            dataEntities.forEach(dataEntity => {
                const entity: EventEntityTranscript = {
                    type: 'transcript',
                    data: dataEntity
                };
                entities.push(entity);
            });
            session.sendEvent(entities);
        }
    };
}
