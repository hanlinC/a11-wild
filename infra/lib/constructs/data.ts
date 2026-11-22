import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/** Where the studio keeps its records and its pictures. Both outlive the stack. */
export class Data extends Construct {
  readonly table: dynamodb.TableV2;
  readonly pictures: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.pictures = new s3.Bucket(this, "Pictures", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      // A client sends a results file from the pack page straight to a link the server signed for that one file.
      // The link is the key, and no cookie goes with it, so any origin may use it; only PUT is opened.
      // A picture the owner uploads for a prospect waits under this prefix until the studio has read it and kept its own copy.
      // A file left here was never kept, so it goes after a day.
      lifecycleRules: [{ id: "outreach-inbox", prefix: "outreach/inbox/", expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: ["*"], allowedHeaders: ["content-type"], maxAge: 300 }],
    });
  }
}
