import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { PixelTool } from "@a11-wild/shared";

/** What the pixel function is sent. Every key in it was looked up by the studio; an agent never types one. */
export interface PixelEvent {
  jobId: string;
  batchId: string;
  tool: PixelTool;
  input: Record<string, unknown>;
  resultKey: string;
  outKey?: string;
}

/** Starts a pixel job. It returns as soon as the job is taken; the result comes later, in the picture store. */
export interface PixelRunner {
  start(event: PixelEvent): Promise<void>;
}

export class LambdaPixelRunner implements PixelRunner {
  constructor(
    private readonly lambda: LambdaClient,
    private readonly functionName: string,
  ) {}

  async start(event: PixelEvent): Promise<void> {
    await this.lambda.send(new InvokeCommand({ FunctionName: this.functionName, InvocationType: "Event", Payload: new TextEncoder().encode(JSON.stringify(event)) }));
  }
}
