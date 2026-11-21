import { ConditionalCheckFailedException, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export interface Item {
  pk: string;
  sk: string;
  /** Epoch seconds. DynamoDB deletes the item some time after this moment. */
  expiresAt?: number;
  [attribute: string]: unknown;
}

/** The few table operations the studio needs. Tests use an in-memory version. */
/** The stored record without its table keys. */
export function record<T>(item: Item & T): T {
  const { pk: _pk, sk: _sk, expiresAt: _expiresAt, ...rest } = item;
  return rest as T;
}

export interface Table {
  get<T extends Item>(pk: string, sk: string): Promise<T | undefined>;
  /** Returns false when `ifNotExists` is set and the item is already there. */
  put(item: Item, options?: { ifNotExists?: boolean }): Promise<boolean>;
  /** With `ifEquals`, deletes only while that attribute still has that value. Returns false when it does not. */
  delete(pk: string, sk: string, options?: { ifEquals?: { attribute: string; value: string } }): Promise<boolean>;
  query<T extends Item>(pk: string): Promise<T[]>;
  /**
   * Adds a whole number to a number attribute in one step, and makes the item when it is missing.
   * With `ceiling`, adds only while the new value stays at or under it, and returns false otherwise.
   */
  add(pk: string, sk: string, attribute: string, amount: number, options?: { ceiling?: number }): Promise<boolean>;
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
          // A gate reads right after a write: it must see that write, as `get` does.
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...((page.Items ?? []) as T[]));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async add(pk: string, sk: string, attribute: string, amount: number, options: { ceiling?: number } = {}): Promise<boolean> {
    const { ceiling } = options;
    if (ceiling !== undefined && amount > ceiling) return false;
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "ADD #attribute :amount",
          ExpressionAttributeNames: { "#attribute": attribute },
          ExpressionAttributeValues: {
            ":amount": amount,
            ...(ceiling !== undefined ? { ":room": ceiling - amount } : {}),
          },
          ...(ceiling !== undefined
            ? { ConditionExpression: "attribute_not_exists(#attribute) OR #attribute <= :room" }
            : {}),
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}
