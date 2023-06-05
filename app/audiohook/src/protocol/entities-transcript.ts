import {
    Duration,
    EventEntityBase,
    MediaChannel,
    Uuid,
} from './core';

export type EventEntityTranscript = EventEntityBase<'transcript', EventEntityDataTranscript>;

export type EventEntityDataTranscript = {
    id: Uuid;
    channel: MediaChannel;
    isFinal: boolean;
    languages: string[];
    position: Duration;
    duration: Duration;
    alternatives: TranscriptAlternative[];
};

export type TranscriptAlternative = {
    confidence: number;
    interpretations: TranscriptInterpretation[];
};

export type TranscriptDisplayTextType = 'none' | 'mask';

export type TranscriptDisplayText = {
    transform?: TranscriptDisplayTextType;
    text: string;
};

export type TranscriptInterpretationType = 'lexical' | 'normalized';

export type TranscriptInterpretation = {
    type: TranscriptInterpretationType;
    display: TranscriptDisplayText[];
    tokens?: TranscriptToken[];
};

export type TranscriptEntityClass =
    | 'name'
    | 'geo'
    | 'org'
    | 'phone'
    | 'number'
    | 'cc'
    | 'digits'
    | 'profanity'
    | 'filter'
    | 'other'
    | string;

export type TranscriptTokenType =
    | 'punct'
    | 'pron'
    | 'word'
    | 'phrase'
    | 'entity';

export type TranscriptToken = {
    type: TranscriptTokenType;
    value: string;
    sensitive?: boolean;
    entityClass?: TranscriptEntityClass;
    confidence: number;
    position: Duration;
    duration?: Duration;
    language?: string;
    components?: TranscriptToken[];
};

/*
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const example1: EventEntityDataTranscript = {
    id: '802095c6-80d2-4dbe-8a9b-57af2d094f53',
    channel: 'external',
    isFinal: true,
    languages: ['en-us'],
    position: 'PT123.4S',
    duration: 'PT1.4S',
    alternatives: [
        {
            confidence: 0.98,
            interpretations: [
                {
                    type: 'lexical',
                    display: [{
                        text: 'is my name felix'
                    }],
                    tokens: [
                        {
                            type: 'word',
                            value: 'is',
                            confidence: 0.95,
                            position: 'PT123.4S'
                        },
                        {
                            type: 'word',
                            value: 'my',
                            confidence: 0.95,
                            position: 'PT123.6S'
                        },
                        {
                            type: 'word',
                            value: 'name',
                            confidence: 0.96,
                            position: 'PT123.8S'
                        },

                        {
                            type: 'word',
                            value: 'felix',
                            confidence: 0.99,
                            position: 'PT124.2S'
                        }
                    ]
                },
                {
                    type: 'normalized',
                    display: [
                        {
                            transform: 'none',
                            text: 'Is my name Felix?'
                        },
                        {
                            transform: 'mask',
                            text: 'Is my name [name]?'
                        }
                    ],
                    tokens: [
                        {
                            type: 'word',
                            value: 'Is',
                            confidence: 0.94,
                            position: 'PT123.4S'
                        },
                        {
                            type: 'word',
                            value: 'my',
                            confidence: 0.96,
                            position: 'PT123.8S'
                        },
                        {
                            type: 'word',
                            value: 'name',
                            confidence: 0.97,
                            position: 'PT123.9S'
                        },
                        {
                            type: 'entity',
                            value: 'Felix',
                            sensitive: true, 
                            entityClass: 'name',
                            confidence: 0.99,
                            position: 'PT124.2S'
                        },
                        {
                            type: 'punct',
                            value: '?',
                            confidence: 0.75,
                            position: 'PT124.4S'
                        },
                    ]
                },
                {
                    type: 'normalized',
                    display: [
                        {
                            transform: 'none',
                            text: 'Is my name Felix?'
                        },
                        {
                            transform: 'mask',
                            text: 'Is my name *?'
                        }
                    ],
                    tokens: [
                        {
                            type: 'word',
                            value: 'Is',
                            confidence: 0.94,
                            position: 'PT123.4S'
                        },
                        {
                            type: 'word',
                            value: 'my',
                            confidence: 0.96,
                            position: 'PT123.8S'
                        },
                        {
                            type: 'word',
                            value: 'name',
                            confidence: 0.97,
                            position: 'PT123.9S'
                        },
                        {
                            type: 'entity',
                            value: 'Felix',
                            sensitive: true, 
                            entityClass: 'name',
                            confidence: 0.99,
                            position: 'PT124.2S'
                        },
                        {
                            type: 'punct',
                            value: '?',
                            confidence: 0.75,
                            position: 'PT124.4S'
                        },
                    ]
                }
            ]
        }
    ]
};


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const example2: EventEntityDataTranscript = {
    id: '802095c6-80d2-4dbe-8a9b-57af2d094f53',
    channel: 'external',
    isFinal: true,
    languages: ['en-us'],
    position: 'PT0S',
    duration: 'PT0S',
    alternatives: [
        {
            confidence: 0.98,
            interpretations: [
                {
                    type: 'normalized',
                    display: [
                        {
                            transform: 'none',
                            text: 'My phone number is 812-327-0943'
                        },
                        {
                            transform: 'mask',
                            text: 'My phone number is *'
                        }
                    ],
                    tokens: [
                        {
                            type: 'word',
                            value: 'My',
                            confidence: 0.94,
                            position: 'PT0S'
                        },
                        {
                            type: 'word',
                            value: 'phone',
                            confidence: 0.96,
                            position: 'PT0S'
                        },
                        {
                            type: 'word',
                            value: 'number',
                            confidence: 0.97,
                            position: 'PT0S'
                        },
                        {
                            type: 'word',
                            value: 'is',
                            confidence: 0.97,
                            position: 'PT0S'
                        },
                        {
                            type: 'entity',
                            value: '812-327-0943',
                            sensitive: true, 
                            confidence: 0.99,
                            position: 'PT0S'
                        },
                    ]
                },
            ]
        }
    ]
};


*/
