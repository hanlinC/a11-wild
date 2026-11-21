import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { Alerts } from "./constructs/alerts.js";
import { Api } from "./constructs/api.js";
import { Auth } from "./constructs/auth.js";
import { Data } from "./constructs/data.js";
import { Pixels } from "./constructs/pixels.js";
import { Web } from "./constructs/web.js";

/** The functions read this parameter at start. Its name is fixed so that they need no reference to it. */
export const CONFIG_PARAMETER = "/a11-wild/runtime-config";

/** The owner stores each provider key under this path, as an encrypted parameter. No key is in the stack or the repository. */
export const KEYS_PREFIX = "/a11-wild/keys";

export interface StudioStackProps extends StackProps {
  buildId: string;
}

export class StudioStack extends Stack {
  constructor(scope: Construct, id: string, props: StudioStackProps) {
    super(scope, id, props);

    const data = new Data(this, "Data");
    const api = new Api(this, "Api", {
      table: data.table,
      configParameterName: CONFIG_PARAMETER,
      pictures: data.pictures,
      keysPrefix: KEYS_PREFIX,
      buildId: props.buildId,
    });
    new Pixels(this, "Pixels", { pictures: data.pictures, caller: api.apiFunction });
    const web = new Web(this, "Web", { apiOriginDomainName: api.originDomainName, picturesDomainName: data.pictures.bucketRegionalDomainName });
    const auth = new Auth(this, "Auth", { publicOrigin: web.publicOrigin });
    const alerts = new Alerts(this, "Alerts");
    alerts.ownerNotices.grantPublish(api.apiFunction);
    api.apiFunction.addEnvironment("OWNER_TOPIC_ARN", alerts.ownerNotices.topicArn);

    // A separate policy, not the functions' default one: the user pool depends on
    // the public address, which depends on the API function. A default policy
    // that named the pool would close that circle.
    new iam.Policy(this, "ManageRegisteredClients", {
      roles: [api.apiFunction.role!, api.pruneFunction.role!],
      statements: [
        new iam.PolicyStatement({
          actions: [
            "cognito-idp:DescribeUserPoolClient",
            "cognito-idp:DeleteUserPoolClient",
            "cognito-idp:ListUserPoolClients",
          ],
          resources: [auth.userPool.userPoolArn],
        }),
      ],
    });

    new ssm.StringParameter(this, "RuntimeConfig", {
      parameterName: CONFIG_PARAMETER,
      description: "Values the a11-wild functions need that exist only after deploy.",
      stringValue: this.toJsonString({
        publicOrigin: web.publicOrigin,
        region: this.region,
        userPoolId: auth.userPool.userPoolId,
        cognitoDomain: auth.domain.baseUrl(),
        dashboardClientId: auth.dashboardClient.userPoolClientId,
      }),
    });

    new CfnOutput(this, "PublicOrigin", { value: web.publicOrigin });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "TableName", { value: data.table.tableName });
    new CfnOutput(this, "PicturesBucketName", { value: data.pictures.bucketName });
  }
}
