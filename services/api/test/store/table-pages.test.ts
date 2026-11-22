import { Readable } from "node:stream";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { DynamoTable } from "../../src/store/table.js";

/** A DynamoDB that answers a query in pages of two items, as the real one does above 1 MB. */
function pagedClient(items: { pk: string; sk: string }[], asked: unknown[]) {
  const reply = (body: unknown) => ({
    response: { statusCode: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: Readable.from([Buffer.from(JSON.stringify(body))]) },
  });
  return new DynamoDBClient({
    region: "ap-southeast-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: {
      handle: async (request: { body: string }) => {
        const query = JSON.parse(request.body) as { ExclusiveStartKey?: { sk: { S: string } } };
        asked.push(query.ExclusiveStartKey?.sk.S);
        const from = query.ExclusiveStartKey ? items.findIndex((item) => item.sk === query.ExclusiveStartKey?.sk.S) + 1 : 0;
        const page = items.slice(from, from + 2);
        const last = page.at(-1);
        return reply({
          Items: page.map((item) => ({ pk: { S: item.pk }, sk: { S: item.sk } })),
          ...(last && from + 2 < items.length ? { LastEvaluatedKey: { pk: { S: last.pk }, sk: { S: last.sk } } } : {}),
        });
      },
      updateHttpClientConfig: () => undefined,
      httpHandlerConfigs: () => ({}),
    } as never,
  });
}

describe("the table's query", () => {
  it("reads a partition that is larger than one page whole", async () => {
    const items = ["a", "b", "c", "d", "e"].map((sk) => ({ pk: "OUTREACH", sk }));
    const asked: unknown[] = [];
    const table = new DynamoTable(pagedClient(items, asked), "studio");
    expect((await table.query("OUTREACH")).map((item) => item.sk)).toEqual(["a", "b", "c", "d", "e"]);
    expect(asked).toEqual([undefined, "b", "d"]);
  });
});
