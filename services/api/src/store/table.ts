import { ConditionalCheckFailedException, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

export interface Item {
  pk: string;
  sk: string;
  /** Epoch seconds. DynamoDB deletes the item some time after this moment. */
  expiresAt?: number;
  [attribute: string]: unknown;
}

/** The few table operations the studio needs. Tests use an in-memory version. */
export interface Table {
  get<T extends Item>(pk: string, sk: string): Promise<T | undefined>;
  /** Returns false when `ifNotExists` is set and the item is already there. */
  put(item: Item, options?: { ifNotExists?: boolean }): Promise<boolean>;
  /** With `ifEquals`, deletes only while that attribute still has that value. Returns false when it does not. */
  delete(pk: string, sk: string, options?: { ifEquals?: { attribute: string; value: string } }): Promise<boolean>;
  query<T extends Item>(pk: string): Promise<T[]>;
}

export class DynamoTable implements Table {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string,
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async get<T extends Item>(pk: string, sk: string): Promise<T | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }),
    );
    return result.Item as T | undefined;
  }

  async put(item: Item, options: { ifNotExists?: boolean } = {}): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ...(options.ifNotExists ? { ConditionExpression: "attribute_not_exists(pk)" } : {}),
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async delete(pk: string, sk: string, options: { ifEquals?: { attribute: string; value: string } } = {}): Promise<boolean> {
    const { ifEquals } = options;
    try {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          ...(ifEquals
            ? {
                ConditionExpression: "#attribute = :value",
                ExpressionAttributeNames: { "#attribute": ifEquals.attribute },
                ExpressionAttributeValues: { ":value": ifEquals.value },
              }
            : {}),
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async query<T extends Item>(pk: string): Promise<T[]> {
    const items: T[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...((page.Items ?? []) as T[]));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return items;
  }
}
