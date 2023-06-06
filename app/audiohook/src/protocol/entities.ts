import { EventEntityBase, JsonValue } from './core';
import { EventEntityTranscript } from './entities-transcript';
import { EventEntityAgentAssist } from './entities-agentassist';

export type EventEntityPredefined = EventEntityTranscript | EventEntityAgentAssist;

export type EventEntity = 
    | EventEntityPredefined
    | EventEntityBase<string, JsonValue>

export type EventEntities = EventEntity[];
