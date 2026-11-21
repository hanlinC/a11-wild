import path from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

const PIXELS_SRC = path.join(import.meta.dirname, "../../../services/pixels");

export interface PixelsProps {
  pictures: s3.IBucket;
  /** The one function that may start a pixel job. */
  caller: lambda.Function;
}

/**
 * The pixel tools: Python with Pillow, NumPy and OpenCV in a container.
 * The function reads and writes pictures and job results, and nothing else:
 * it has no table, no provider key and no way to the internet that a job can name.
 */
export class Pixels extends Construct {
  readonly pixelFunction: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: PixelsProps) {
    super(scope, id);

    this.pixelFunction = new lambda.DockerImageFunction(this, "PixelFunction", {
      code: lambda.DockerImageCode.fromImageAsset(PIXELS_SRC, { platform: Platform.LINUX_AMD64 }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008,
      timeout: Duration.minutes(3),
      // A job that failed already wrote why. A second run would only repeat it.
      retryAttempts: 0,
      environment: { PICTURES_BUCKET: props.pictures.bucketName },
      logGroup: new logs.LogGroup(this, "PixelFunctionLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Brand pictures are read; batch pictures are read and written; a job result is written. Nothing is listed or deleted.
    this.pixelFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: ["brands/*", "products/*", "batches/*"].map((prefix) => props.pictures.arnForObjects(prefix)),
      }),
    );
    this.pixelFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [props.pictures.arnForObjects("batches/*"), props.pictures.arnForObjects("jobs/*")],
      }),
    );

    this.pixelFunction.grantInvoke(props.caller);
    props.caller.addEnvironment("PIXELS_FUNCTION", this.pixelFunction.functionName);
  }
}
