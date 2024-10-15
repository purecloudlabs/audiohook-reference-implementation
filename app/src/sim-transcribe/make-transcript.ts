import {
    EventEntityDataTranscript,
    MediaChannelId,
    TranscriptAlternative,
    TranscriptInterpretationType,
    TranscriptInterpretation,
    TranscriptToken,
    TranscriptTokenType,
    LanguageCode
} from '../../audiohook/src/protocol';
import { VoiceEvent } from './voice-activity-detection/voice-event';
import { v4 as uuid } from 'uuid';
import { StreamDuration } from '../../audiohook';

class Token {
    type: TranscriptTokenType;
    value: string;
    offsetMs: number;
    durationMs: number;

    constructor(type: TranscriptTokenType, value: string, offsetMs: number, durationMs: number) {
        this.type = type;
        this.value = value;
        this.offsetMs = offsetMs;
        this.durationMs = durationMs;
    }
}

const TOKENS = new Map<string, Token[]>([
    ['en', [
        new Token('word', 'My', 50, 390),
        new Token('word', 'name', 490, 230),
        new Token('word', 'is', 740, 350),
        new Token('word', 'John,', 1120, 130),
        new Token('word', 'and', 1260, 970),
        new Token('word', 'my', 2240, 290),
        new Token('word', 'number', 2540, 110),
        new Token('word', 'is', 2660, 490),
        new Token('word', '3.', 3280, 450)
    ]],
    ['fr', [
        new Token('word', 'Je', 50, 390),
        new Token('word', 'mappelle', 490, 230),
        new Token('word', 'John', 740, 350),
        new Token('word', 'et,', 1120, 130),
        new Token('word', 'mon', 1260, 970),
        new Token('word', 'numéro', 2240, 290),
        new Token('word', 'le', 2540, 110),
        new Token('word', '3', 2660, 490)
    ]],
    ['pt', [
        new Token('word', 'Meu', 50, 390),
        new Token('word', 'nome', 490, 230),
        new Token('word', 'é', 740, 350),
        new Token('word', 'John,', 1120, 130),
        new Token('word', 'e', 1260, 970),
        new Token('word', 'meu', 2240, 290),
        new Token('word', 'número', 2540, 110),
        new Token('word', 'é', 2660, 490),
        new Token('word', '3.', 3280, 450)
    ]],
    ['zh', [
        new Token('word', '我', 50, 390),
        new Token('word', '的名', 490, 230),
        new Token('word', '字是', 740, 350),
        new Token('word', '约翰,', 1120, 130),
        new Token('word', '我', 1260, 970),
        new Token('word', '的', 2240, 290),
        new Token('word', '号码', 2540, 110),
        new Token('word', '是', 2660, 490),
        new Token('word', '3.', 3280, 450)
    ]],
    ['cmn', [
        new Token('word', '我', 50, 390),
        new Token('word', '的名', 490, 230),
        new Token('word', '字是', 740, 350),
        new Token('word', '約翰,', 1120, 130),
        new Token('word', '我', 1260, 970),
        new Token('word', '的', 2240, 290),
        new Token('word', '號碼', 2540, 110),
        new Token('word', '是', 2660, 490),
        new Token('word', '3.', 3280, 450)
    ]],
    ['bg', [
        new Token('word', 'Казвам', 50, 390),
        new Token('word', 'се', 490, 230),
        new Token('word', 'Джон,', 740, 350),
        new Token('word', 'и', 1120, 130),
        new Token('word', 'номерът', 1260, 970),
        new Token('word', 'ми', 2240, 290),
        new Token('word', 'е', 2540, 110),
        new Token('word', '3', 2660, 490)
    ]],
    ['el', [
        new Token('word', 'Το', 50, 390),
        new Token('word', 'όνομά', 490, 230),
        new Token('word', 'μου', 740, 350),
        new Token('word', 'είναι', 1120, 130),
        new Token('word', 'Γιάννης', 1260, 970),
        new Token('word', 'και', 2240, 290),
        new Token('word', 'ο', 2540, 110),
        new Token('word', 'αριθμός', 2660, 490),
        new Token('word', 'μου', 3280, 450),
        new Token('word', 'είναι', 3730, 450),
        new Token('word', '3', 4180, 450)
    ]],
]);

const secondsToMilli = (timeInSeconds: number) => {
    return Math.round(timeInSeconds * 1000);
};

const milliSecondsToSeconds = (timeInMilliSeconds: number) => {
    return timeInMilliSeconds/1000;
};

const makeInterpretation = (transcriptInterpretationType: TranscriptInterpretationType, startPosition: StreamDuration, duration: StreamDuration, languageCode: LanguageCode) => {
    const interpretation: TranscriptInterpretation = {
        type: transcriptInterpretationType,
        transcript: '',
        tokens: []
    };

    let language = 'en';
    if (languageCode) {
        const parts = languageCode.split('-');
        language = parts[0];
    }

    const tokens: Token[] = TOKENS.get(language) || [];
    let text = '';

    let i = 0;
    let count = 0;
    let token: Token = tokens[i];
    let durationMs = duration.milliseconds;
    while (durationMs > token.durationMs) {
        const transcriptToken: TranscriptToken = {
            type: token.type,
            value: token.value,
            confidence: 0.9,
            offset: startPosition.withAddedMilliseconds(token.offsetMs).asDuration(),
            duration: StreamDuration.fromMilliseconds(token.durationMs).asDuration(),
            language: language
        };
        interpretation.tokens?.push(transcriptToken);
        durationMs -= token.durationMs;

        text += ' ' + token.value;

        ++count;
        i = count % tokens.length;
        token = tokens[i];
    }
    if (interpretation.tokens?.length ?? 0 > 0) {
        interpretation.transcript = text.substring(1);
        return interpretation;
    } else {
        return undefined;
    }

};

export const makeTranscript = (channelId: MediaChannelId, voiceEvent: VoiceEvent, language: LanguageCode, vadPositionMs: StreamDuration) => {
    const eventStartPositionMs: StreamDuration = vadPositionMs.withAddedMilliseconds(secondsToMilli(voiceEvent.getStartTime()));
    const eventEndPositionMs: StreamDuration = vadPositionMs.withAddedMilliseconds(secondsToMilli(voiceEvent.getEndTime()));
    const durationMs: StreamDuration = StreamDuration.fromMilliseconds(eventEndPositionMs.milliseconds - eventStartPositionMs.milliseconds);

    const transcriptAlternative: TranscriptAlternative = {
        confidence: 0.9,
        interpretations: []
    };

    const displayInterpretation = makeInterpretation(
        'display',
        eventStartPositionMs,
        durationMs,
        language
    );
    if (displayInterpretation) {
        transcriptAlternative.interpretations.push(displayInterpretation);
    }

    if (transcriptAlternative.interpretations.length > 0) {
        const transcript: EventEntityDataTranscript = {
            id: uuid(),
            channelId: channelId,
            isFinal: true,
            offset: eventStartPositionMs.asDuration(),
            duration: durationMs.asDuration(),
            alternatives: [transcriptAlternative]
        };

        return transcript;
    } else {
        return undefined;
    }
};