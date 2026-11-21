#!/usr/bin/env node
// Invites one person: makes the sign-in account and the studio's user row.
// The user pool emails a temporary password; the person sets their own at first sign-in.
//
//   npm run user:invite -- <email> <owner|member>
//
// Uses the AWS credentials and Region of your shell. The address goes to AWS only.
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { AdminCreateUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const STACK = "A11WildStudio";

const [email, role] = process.argv.slice(2);
if (!email?.includes("@") || !["owner", "member"].includes(role)) {
  console.error("Usage: npm run user:invite -- <email> <owner|member>");
  process.exit(1);
}

const stacks = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: STACK }));
const outputs = Object.fromEntries((stacks.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
if (!outputs.UserPoolId || !outputs.TableName) {
  console.error(`Stack ${STACK} has no UserPoolId or TableName output. Deploy it first.`);
  process.exit(1);
}

const created = await new CognitoIdentityProviderClient({}).send(
  new AdminCreateUserCommand({
    UserPoolId: outputs.UserPoolId,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ],
    DesiredDeliveryMediums: ["EMAIL"],
  }),
);
const sub = created.User?.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
if (!sub) {
  console.error("The user pool returned no user id.");
  process.exit(1);
}

await new DynamoDBClient({}).send(
  new PutItemCommand({
    TableName: outputs.TableName,
    Item: { pk: { S: "USER" }, sk: { S: sub }, email: { S: email }, role: { S: role } },
  }),
);
console.log(`Invited as ${role}. The temporary password is on its way by email.`);
