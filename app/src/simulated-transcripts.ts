import {
    OpenHandler,
    ServerSession as Session,
    MediaSelector,
    MediaChannel,
    MediaDataFrame,
    VoiceActivityDetector,
    CloseHandler,
    EventEntityTranscript,
    EventEntityDataTranscript,
    UpdateHandler,
    LanguageCode,
    ResumedParameters,
    StreamDuration,
    isValidLanguageCode
} from '../audiohook';
import ByteBuffer from 'bytebuffer';
import { VoiceEvent } from '../audiohook/src/utils/voice-activity-detection/voice-event';
import { makeTranscript } from '../audiohook/src/utils/make-transcript';

export class SimulatedTranscripts {

    private vad_internal: VoiceActivityDetector;
    private vad_external: VoiceActivityDetector;
    private language: LanguageCode;
    private vadPositionMs = 0;

    private handleChannelData = (buffer: ByteBuffer, vad: VoiceActivityDetector, channel: MediaChannel, entities: EventEntityDataTranscript[]) => {
        const events: VoiceEvent[] = vad.detectVoiceActivity(buffer);
        events.forEach(event => {
            const transcript = makeTranscript(channel, event, this.language, this.vadPositionMs);
            if (transcript) {
                entities.push(transcript);
            }
        });
    };
    
    private handleChannelClose = (vad: VoiceActivityDetector, channel: MediaChannel, entities: EventEntityDataTranscript[]) => {
        const events: VoiceEvent[] = vad.notifyEndOfStream();
        events.forEach(event => {
            const transcript = makeTranscript(channel, event, this.language, this.vadPositionMs);
            if (transcript) {
                entities.push(transcript);
            }
        });
    };
    
    private closeAuio = (session: Session) => {
        const entities: EventEntityDataTranscript[] = [];
        if (session.selectedMedia?.channels.length == 2) {
            this.handleChannelClose(this.vad_external, 'external', entities);
            this.handleChannelClose(this.vad_internal, 'internal', entities);
        } else if (session.selectedMedia?.channels.length == 1) {
            if (session.selectedMedia.channels[0] == 'external') {
                this.handleChannelClose(this.vad_external, 'external', entities);
            } else {
                this.handleChannelClose(this.vad_internal, 'internal', entities);
            }
        } else {
            throw new Error('No Channel present');
        }
        this.sendEvent(session, entities);
        // vad_internal = new VoiceActivityDetector();
        // vad_external = new VoiceActivityDetector();
    };
    
    private updateLanguage = (session: Session) => {
        if(!session.language) {
            session.logger.info('Pausing since language not set');
            session.pause();
        } else if (!isValidLanguageCode(session.language)) {
            session.logger.info('Pausing since language is not valid');
            session.pause();
        } else {
            session.logger.info(`Updating language to ${session.language}`);
            this.language = session.language;
            this.vad_internal = new VoiceActivityDetector();
            this.vad_external = new VoiceActivityDetector();        
        }
    };
    
    private transcriptOpenHandler: OpenHandler = ({ session }) => {
        const audioHandler = (frame: MediaDataFrame) => {
            if (frame.channels.length < 1) {
                throw new Error('No Channel present');
            }
    
            const channelData = new Map();
            frame.getChannelViews().forEach(channel => {
                channelData.set(channel.channel, channel.data);
            });
    
            const entities: EventEntityDataTranscript[] = [];
            if (channelData.get('external') != null) {
                this.handleChannelData(ByteBuffer.wrap(channelData.get('external')), this.vad_external, 'external', entities);
            }
            if (channelData.get('internal') != null) {
                this.handleChannelData(ByteBuffer.wrap(channelData.get('internal')), this.vad_internal, 'internal', entities);
            }
            this.sendEvent(session, entities);
        };
    
        this.vadPositionMs = session.position.milliseconds;
        this.updateLanguage(session);
        if (session.state != 'PAUSED') {
            session.on('audio',audioHandler);
        }
    
        const pausedHandler = () => {
            this.closeAuio(session);
            session.off('audio', audioHandler);
        };
        session.on('paused', pausedHandler);
    
        const resumedHandler = (resumedMessage: ResumedParameters) => {
            // vadPositionMs = (resumedMessage.start + resumedMessage.discarded) in milliseconds
            this.vadPositionMs = StreamDuration.fromDuration(resumedMessage.start).withAdded(StreamDuration.fromDuration(resumedMessage.discarded)).milliseconds;
            this.updateLanguage(session);
            session.on('audio',audioHandler);
        };
        session.on('resumed', resumedHandler);
    
        return () => {
            session.off('audio', audioHandler);
            session.off('paused', pausedHandler);
            session.off('resumed', resumedHandler);
        };
    };
    
    private transcriptUpdatenHandler: UpdateHandler = (session) => {
        this.closeAuio(session);
        if (session.state === 'PAUSED') {
            session.logger.info('Resuming from PAUSED state since language is valid');
            session.resume();
        } else {
            this.vadPositionMs = session.position.milliseconds;
            this.updateLanguage(session);
        }
    };
    
    private transcriptCloseHandler: CloseHandler = (session) => {
        this.closeAuio(session);
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
    
    
    private transcriptMediaSelector: MediaSelector = (session, offered) => {
        const stereo = offered.filter(media => (media.channels.length === 2));
        if (stereo.length === 0) {
            session.disconnect('error', 'No matching media format offered. Voice transcription needs two channels!');
        }
        session.addOpenHandler(this.transcriptOpenHandler);
        session.addUpdateHandler(this.transcriptUpdatenHandler);
        session.addCloseHandler(this.transcriptCloseHandler);
        return stereo;
    };
    
    
    public addTranscriptions = (session: Session) => {
        session.addMediaSelector(this.transcriptMediaSelector);
    };
}
