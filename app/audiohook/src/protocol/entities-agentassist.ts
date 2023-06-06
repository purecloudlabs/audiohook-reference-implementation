import {
    Duration,
    EventEntityBase,
    MediaChannel,
    Uuid,
} from './core';

export type EventEntityAgentAssist = EventEntityBase<'agentassist', EventEntityDataAgentAssist>;

export type EventEntityDataAgentAssist = {
    id: Uuid;
    utterances?: EventEntityAgentAssistUtterance[];
    suggestions?: EventEntityAgentAssistSuggestion[];
};

export type EventEntityAgentAssistUtterance = {
    id: Uuid;
    position: Duration;
    duration?: Duration;
    text: string;
    language: string;
    confidence: number;
    channel: MediaChannel;
    isFinal: boolean;
};

export type EventEntityAgentAssistSuggestion = EventEntityAgentAssistSuggestionFaq | EventEntityAgentAssistSuggestionArticle;

export type EventEntityAgentAssistSuggestionBase<T extends string> = {
    type: T;
    id: Uuid;
    confidence: number;
    position?: Duration;
};

export type EventEntityAgentAssistSuggestionFaq = EventEntityAgentAssistSuggestionBase<'faq'> & {
    question: string;       // plain text
    answer: string;         // HTML (limited/sanitized subset)
};

export type EventEntityAgentAssistSuggestionArticle = EventEntityAgentAssistSuggestionBase<'article'> & {
    title: string;          // plain text
    excerpts: string[];     // plain text/possibly limited HTML markup
    documentUri: string;
    metadata?: Record<string, string>;
};
