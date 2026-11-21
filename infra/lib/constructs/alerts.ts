import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/** Holds the address that gets cost alerts. Made by hand once, so the address is in no file. */
export const ALERT_EMAIL_PARAMETER = "/a11-wild/alert-email";

const MONTHLY_ALERT_USD = 10;

/** Emails the owner when the month's AWS cost passes the alert amount. */
export class Alerts extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

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
              address: ssm.StringParameter.valueForStringParameter(this, ALERT_EMAIL_PARAMETER),
            },
          ],
        },
      ],
    });
  }
}
