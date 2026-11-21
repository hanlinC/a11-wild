import { Refusal } from "./mcp/registry.js";
import { GetParameterCommand, ParameterNotFound, type SSMClient } from "@aws-sdk/client-ssm";

export type ProviderName = "parallel" | "fal";

/** The owner has not stored this provider's key yet. */
export class MissingKeyError extends Refusal {
  constructor(provider: ProviderName) {
    super(`The studio has no ${provider} key yet. The owner stores it once in the AWS project; no tool takes a key.`);
  }
}

export interface ProviderKeys {
  get(provider: ProviderName): Promise<string>;
}

/**
 * Provider keys are encrypted parameters, read when a call needs one. A key is kept in this
 * function instance's memory only: never in an environment variable, a reply or a log line.
 */
export class ParameterKeys implements ProviderKeys {
  private readonly cache = new Map<ProviderName, string>();

  constructor(
    private readonly ssm: Pick<SSMClient, "send">,
    private readonly prefix: string,
  ) {}

  async get(provider: ProviderName): Promise<string> {
    const cached = this.cache.get(provider);
    if (cached) return cached;
    let value: string | undefined;
    try {
      const result = await this.ssm.send(new GetParameterCommand({ Name: `${this.prefix}/${provider}`, WithDecryption: true }));
      value = result.Parameter?.Value?.trim();
    } catch (error) {
      if (!(error instanceof ParameterNotFound)) throw error;
    }
    if (!value) throw new MissingKeyError(provider);
    this.cache.set(provider, value);
    return value;
  }
}
