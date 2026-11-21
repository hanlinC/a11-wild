import * as budgets from "aws-cdk-lib/aws-budgets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/** Holds the address that gets cost alerts. Made by hand once, so the address is in no file. */
export const ALERT_EMAIL_PARAMETER = "/a11-wild/alert-email";

const MONTHLY_ALERT_USD = 10;

/** Emails the owner: when the month's AWS cost passes the alert amount, and when the studio has a notice. */
export class Alerts extends Construct {
  /** The studio publishes here when something waits on the owner, such as a new program to approve. */
  readonly ownerNotices: sns.Topic;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const address = ssm.StringParameter.valueForStringParameter(this, ALERT_EMAIL_PARAMETER);

    this.ownerNotices = new sns.Topic(this, "OwnerNotices", { enforceSSL: true });
    new sns.Subscription(this, "OwnerNoticesEmail", { topic: this.ownerNotices, protocol: sns.SubscriptionProtocol.EMAIL, endpoint: address });

    new budgets.CfnBudget(this, "MonthlyCost", {
      budget: {
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_ALERT_USD, unit: "USD" },
        // Cost before credits, so the alert is not hidden while a credit pays the bill.
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              subscriptionType: "EMAIL",
              address,
            },
          ],
        },
      ],
    });
  }
}
