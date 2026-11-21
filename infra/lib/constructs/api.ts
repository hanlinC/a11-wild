import path from "node:path";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

const REPO_ROOT = path.join(import.meta.dirname, "../../..");
const API_SRC = path.join(REPO_ROOT, "services/api/src");

export interface ApiProps {
  table: dynamodb.ITableV2;
  /** Name of the parameter that holds the values known only after deploy. */
  configParameterName: string;
  /** Where the studio keeps its pictures. Only the API function reads and writes it. */
  pictures: s3.IBucket;
  /** The path under which the owner stores the provider keys, as encrypted parameters. */
  keysPrefix: string;
  buildId: string;
}

/** The API function behind an HTTP API, and the daily clean-up function. */
export class Api extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly apiFunction: NodejsFunction;
  readonly pruneFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const configParameterArn = Stack.of(this).formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: props.configParameterName.replace(/^\//, ""),
    });

    const makeFunction = (name: string, entry: string, timeout: Duration) => {
      const fn = new NodejsFunction(this, name, {
        entry: path.join(API_SRC, entry),
        depsLockFilePath: path.join(REPO_ROOT, "package-lock.json"),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout,
        environment: {
          TABLE_NAME: props.table.tableName,
          CONFIG_PARAMETER: props.configParameterName,
          BUILD_ID: props.buildId,
        },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          format: OutputFormat.ESM,
          target: "node22",
          minify: true,
          mainFields: ["module", "main"],
          // Ship the AWS SDK the tests ran with. The copy built into the runtime is
          // older and drops fields it does not know, such as a client's type.
          externalModules: [],
          // Some bundled packages still call require().
          banner: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
        },
      });
      props.table.grantReadWriteData(fn);
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameter"], resources: [configParameterArn] }));
      return fn;
    };

    this.apiFunction = makeFunction("ApiFunction", "handler.ts", Duration.seconds(29));
    this.apiFunction.addEnvironment("KEYS_PREFIX", props.keysPrefix);
    this.apiFunction.addEnvironment("PICTURES_BUCKET", props.pictures.bucketName);
    props.pictures.grantReadWrite(this.apiFunction);
    // The provider keys are read by this one function, at the moment a call needs one.
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          Stack.of(this).formatArn({
            service: "ssm",
            resource: "parameter",
            resourceName: `${props.keysPrefix.replace(/^\//, "")}/*`,
          }),
        ],
      }),
    );
    this.pruneFunction = makeFunction("PruneFunction", "prune-handler.ts", Duration.minutes(5));

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", this.apiFunction),
    });
    // No firewall sits in front, so the stage itself limits the request rate.
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };

    new events.Rule(this, "PruneDaily", {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new targets.LambdaFunction(this.pruneFunction, { retryAttempts: 1 })],
    });
  }

  /** Host name of the HTTP API, for use as a CloudFront origin. */
  get originDomainName(): string {
    const stack = Stack.of(this);
    return `${this.httpApi.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`;
  }
}
