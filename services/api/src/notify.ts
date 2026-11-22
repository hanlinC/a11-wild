import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";
import type { Item, Table } from "./store/table.js";

export interface WaitingClient {
  name: string;
  callbackUrls: string[];
  seenBy: string;
}

/** What a client did on their page. It names the brand and the kind of thing: never the client's words and never a file's name. */
export interface ClientActivity {
  brandId: string;
  brand: string;
  kind: "comment" | "change" | "file";
}

/** Tells the owner about something that waits on them. */
export interface Notifier {
  clientWaiting(client: WaitingClient): Promise<void>;
  clientActivity(activity: ClientActivity): Promise<void>;
}

const DID: Record<ClientActivity["kind"], string> = { comment: "sent a comment", change: "asked for a change to an ad", file: "sent a results file" };

/** The email's text. What the client wrote stays in the studio: an email is no place for a stranger's text or file. */
export function activityMessage(activity: ClientActivity, dashboardOrigin: string): { subject: string; body: string } {
  // The brand's name is the owner's own data. It is cut and cleaned all the same, because a subject is one line.
  const brand = activity.brand.replace(/\p{Cc}/gu, " ").slice(0, 50);
  return {
    // The topic takes a subject of plain ASCII, under 100 characters, on one line.
    subject: `a11 wild: ${brand.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").trim() || "a client"} ${DID[activity.kind]}`.slice(0, 99),
    body: [
      `The client of ${brand} ${DID[activity.kind]} on their page.`,
      "",
      `Read it in the dashboard: ${dashboardOrigin}/clients`,
      "",
      "This email holds nothing the client wrote or sent. More from the same client in the next 10 minutes sends no second email.",
    ].join("\n"),
  };
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

  async clientActivity(activity: ClientActivity): Promise<void> {
    const { subject, body } = activityMessage(activity, this.dashboardOrigin);
    await this.sns.send(new PublishCommand({ TopicArn: this.topicArn, Subject: subject, Message: body }));
  }
}

export const NOTICE_GAP_MS = 10 * 60 * 1000;

/**
 * One email for each brand in ten minutes at most. A page that anyone with the link can write to
 * must not be a way to fill the owner's inbox: the dashboard shows everything, the email only says "look".
 */
export class ActivityNotices {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date,
    private readonly notifier?: Notifier,
  ) {}

  async tell(activity: ClientActivity): Promise<void> {
    if (!this.notifier) return;
    const at = this.now().getTime();
    const last = await this.table.get<Item & { at: number }>("NOTICE", activity.brandId);
    if (last && at - last.at < NOTICE_GAP_MS) return;
    // Submissions at the same moment all pass the read above. Only one of them takes the ten minutes it falls in.
    const window = Math.floor(at / NOTICE_GAP_MS);
    if (!(await this.table.put({ pk: "NOTICE", sk: `${activity.brandId}#${window}`, at, expiresAt: Math.floor(at / 1000) + 24 * 60 * 60 }, { ifNotExists: true }))) return;
    await this.table.put({ pk: "NOTICE", sk: activity.brandId, at });
    await this.notifier.clientActivity(activity);
  }
}
