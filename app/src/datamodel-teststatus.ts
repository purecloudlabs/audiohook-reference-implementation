import dotenv from 'dotenv';
import {
    DynamoDBClient,
    PutItemCommand,
    AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
    UpdateableItems,
    PrimaryKey,
    GSI1Key,
    GSI2Key,
    TypedAttributeValue,
    makeUpdateItemCommand,
} from './dynamodb-utils';
import {
    StreamDuration,
    Uuid,
    Duration,
    OpenParameters,
    JsonObject,
} from '../audiohook';

dotenv.config();


const dataTableName = process.env['DYNAMODB_TABLE_NAME'] ?? null;

const dataItemsTtl = 24*3600;  // Expire items after a day

const makeTtlAttributeValue = (now?: Date): AttributeValue.NMember => {
    return {
        N: Math.ceil((now?.getTime() ?? Date.now())/1000 + dataItemsTtl).toFixed(0)
    };
};


//
// teststatus
// ----------
//
// PK: SESSION#{sessionId}
// SK: TESTSTATUS
// type: <string: "teststatus">
// createdAt: <string: ISO6801>
// orgId: <string: orgId>
// sessionId: <string: sessionId>
// correlationId: <string: correlationId>
// position: <string: Duration>
// state: <string>
// openParams: <string: JSON>
// result?: <string: JSON>
// ttl: <number>
// GSI1PK: CORR#{correlationId}
// GSI1SK: SESSION#{sessionId}

type TestStatusItemKey = PrimaryKey<`SESSION#${Uuid}`, 'TYPE#teststatus'>;
type TestStatusItemGSI1Key = GSI1Key<`CORRELATION#${Uuid}`, `TS#${string}`>;
type TestStatusItemGSI2Key = GSI2Key<`ORGID#${Uuid}`, `TS#${string}`>;
type TestStatusItemData = {
    readonly createdAt: TypedAttributeValue<string>,
    readonly type: TypedAttributeValue<string>,
    readonly orgId: TypedAttributeValue<Uuid>,
    readonly sessionId: TypedAttributeValue<Uuid>,
    readonly correlationId: TypedAttributeValue<Uuid>,
    position: TypedAttributeValue<Duration>,
    state: TypedAttributeValue<string>,
    openParams: TypedAttributeValue<string>,
    result?: TypedAttributeValue<string>,
    ttl: TypedAttributeValue<number>,
};

type TestStatusItem = TestStatusItemKey & TestStatusItemGSI1Key & TestStatusItemGSI2Key & TestStatusItemData;


export interface TestStatusDataItem {
    updateStatus(position: StreamDuration, state: string): Promise<void>;
    finalize(position: StreamDuration, state: string, result: JsonObject): Promise<void>;
}


class TestStatusDataItemImpl implements TestStatusDataItem {
    constructor(
        private readonly client: DynamoDBClient,
        private readonly table: string,
        private readonly key: TestStatusItemKey
    ) {
    }

    static async create(client: DynamoDBClient, table: string, params: CreateTestStatusItemParams): Promise<TestStatusDataItem> {
        const now = new Date(Date.now());
        const timestamp = now.toISOString().substring(0, 23);
        const key: TestStatusItemKey = {
            PK: { S: `SESSION#${params.sessionId}` },
            SK: { S: 'TYPE#teststatus' },
        };
        const item: TestStatusItem = {
            ...key,
            createdAt: { S: timestamp },
            type: { S: 'teststatus' },
            orgId: { S: params.orgId },
            sessionId: { S: params.sessionId },
            correlationId: { S: params.correlationId },
            position: { S: params.position.asDuration() },
            state: { S: 'open' },
            openParams: { S: JSON.stringify(params.openParams) },
            ttl: makeTtlAttributeValue(now),
            GSI1PK: { S: `CORRELATION#${params.conversationId}` },
            GSI1SK: { S: `TS#${timestamp}` },
            GSI2PK: { S: `ORGID#${params.orgId}` },
            GSI2SK: { S: `TS#${timestamp}` },
        };

        const putCommand = new PutItemCommand({
            TableName: table,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK)'
        });

        await client.send(putCommand);
        return new TestStatusDataItemImpl(client, table, key);
    }

    async _updateAux(position: StreamDuration, state: string, items?: UpdateableItems<TestStatusItem>): Promise<void> {
        const updates: UpdateableItems<TestStatusItem> = {
            state: { S: state },
            position: { S: position.asDuration() },
            ttl: makeTtlAttributeValue(),
            ...items
        };
        const updateCommand = makeUpdateItemCommand(this.table, this.key, updates);
        await this.client.send(updateCommand);
    }

    async updateStatus(position: StreamDuration, state: string): Promise<void> {
        await this._updateAux(position, state);
    }

    async finalize(position: StreamDuration, state: string, result: JsonObject): Promise<void> {
        await this._updateAux(position, state, {
            result: { S: JSON.stringify(result) }
        });
    }
}

export type CreateTestStatusItemParams = {
    orgId: string;
    sessionId: string;
    correlationId: string;
    conversationId: string;
    openParams: OpenParameters;
    position: StreamDuration;
};

export const createTestStatusDataItem = async (client: DynamoDBClient, params: CreateTestStatusItemParams): Promise<TestStatusDataItem|null> => {
    if(!dataTableName) {
        return null;
    }
    return TestStatusDataItemImpl.create(client, dataTableName, params);
};
