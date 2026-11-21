import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";

export interface WaitingClient {
  name: string;
  callbackUrls: string[];
  seenBy: string;
}

/** Tells the owner about something that waits on them. */
export interface Notifier {
  clientWaiting(client: WaitingClient): Promise<void>;
}

/** The email's text. It holds no token and no secret: only what the Connections page shows. */
export function waitingMessage(client: WaitingClient, dashboardOrigin: string): { subject: string; body: string } {
  const sendsTo = client.callbackUrls.length > 0 ? client.callbackUrls.join(", ") : "no address given";
  return {
    subject: "a11 wild: a program waits for your approval",
    body: [
      `A program named "${client.name || "Unnamed program"}" signed in as ${client.seenBy} and now waits for your approval.`,
      `It sends you back to: ${sendsTo}`,
      "",
      `Approve it only if you started it yourself: ${dashboardOrigin}/connections`,
      "",
      "Until you approve it, it can do nothing. A program you do not approve is removed after 24 hours.",
    ].join("\n"),
  };
}

/** Publishes to the owner's topic, which emails the owner. */
export class SnsNotifier implements Notifier {
  constructor(
    private readonly sns: SNSClient,
    private readonly topicArn: string,
    private readonly dashboardOrigin: string,
  ) {}

  async clientWaiting(client: WaitingClient): Promise<void> {
    const { subject, body } = waitingMessage(client, this.dashboardOrigin);
    await this.sns.send(new PublishCommand({ TopicArn: this.topicArn, Subject: subject, Message: body }));
  }
}
