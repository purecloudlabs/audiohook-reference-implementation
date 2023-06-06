import { AttributeValue, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export type NonConstMembers<T> = { [P in keyof T]-?: (<W>() => W extends { [K in P]: T[P] } ? 0 : 1) extends (<W>() => W extends { -readonly [K in P]: T[P] } ? 0 : 1) ? P : never }[keyof T];

export type UpdateableItems<T> = Partial<Pick<T, NonConstMembers<T>>>;

export type TypedAttributeValue<T> = (
    T extends string ? {
        S: T;
    } : T extends number ? {
        N: string;
    } : T extends boolean ? {
        BOOL: T;
    } : T extends null ? {
        NULL: boolean;
    } : never
);

export type PrimaryKey<Partition extends string, Sort extends string> = {
    readonly PK: { S: Partition },
    readonly SK: { S: Sort },
};

export type GSI1Key<Partition extends string, Sort extends string> = {
    readonly GSI1PK: { S: Partition },
    readonly GSI1SK: { S: Sort },
};

export type GSI2Key<Partition extends string, Sort extends string> = {
    readonly GSI2PK: { S: Partition },
    readonly GSI2SK: { S: Sort },
};

export const makeUpdateItemCommand = <I extends Record<string, AttributeValue>, P extends string, S extends string>(table: string, key: PrimaryKey<P, S>, items: I): UpdateItemCommand => {
    const entries = Object.entries(items);
    return new UpdateItemCommand({
        TableName: table,
        Key: key,
        UpdateExpression: `SET ${entries.map(([name]) => `#${name} = :${name}`).join(',')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: Object.fromEntries(entries.map(([name]) => [`#${name}`, name])),
        ExpressionAttributeValues: Object.fromEntries(entries.map(([name, value]) => [`:${name}`, value]))
    });
};
