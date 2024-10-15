import {
    Duration,
    EventEntityBase,
    LanguageCode,
    MediaChannelId,
    Uuid,
} from './core';

export type EventEntityTranscript = EventEntityBase<'transcript', EventEntityDataTranscript>;

export type EventEntityDataTranscript = {
    id: Uuid;
    channelId: MediaChannelId;
    isFinal: boolean;
    offset?: Duration;
    duration?: Duration;
    alternatives: TranscriptAlternative[];
};

export type TranscriptAlternative = {
    confidence: number;
    languages?: LanguageCode[];
    interpretations: TranscriptInterpretation[];
};

export type TranscriptInterpretationType = 'display';

export type TranscriptInterpretation = {
    type: TranscriptInterpretationType;
    transcript: string;
    tokens?: TranscriptToken[];
};

export type TranscriptTokenType = 'word';

export type TranscriptToken = {
    type: TranscriptTokenType;
    value: string;
    confidence: number;
    offset: Duration;
    duration: Duration;
    language?: LanguageCode;
};
