import { Duration, Fn, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

/** Must match MCP_SCOPE_NAME in services/api/src/config.ts. */
const MCP_SCOPE_NAME = "studio";

export interface AuthProps {
  /** The one public origin, for example https://host. */
  publicOrigin: string;
}

/**
 * Sign-in for people and for MCP clients. People are invited; there is no
 * sign-up form. MCP clients register themselves and sign a person in through
 * managed login, and the studio then waits for the owner's approval.
 */
export class Auth extends Construct {
  readonly userPool: cognito.UserPool;
  readonly dashboardClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    const mcpResource = `${props.publicOrigin}/mcp`;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Anyone can register a client, so registration gives nothing by itself:
    // only the authorization-code grant, and only the studio scope.
    const cfnPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnPool.addPropertyOverride("DcrConfiguration", {
      EnableStatus: "Enabled",
      OpenDcrEnabled: true,
      OpenDcrGrantTypes: ["code"],
      AuthenticatedGrantTypes: [],
      AllowedScopes: [`${mcpResource}/${MCP_SCOPE_NAME}`],
    });

    this.userPool.addResourceServer("McpResource", {
      identifier: mcpResource,
      userPoolResourceServerName: "a11-wild MCP server",
      scopes: [new cognito.ResourceServerScope({ scopeName: MCP_SCOPE_NAME, scopeDescription: "Use the studio's tools" })],
    });

    // The prefix must be unique in the Region; part of the stack's own id makes it so.
    const stackUuid = Fn.select(2, Fn.split("/", Stack.of(this).stackId));
    this.domain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: Fn.join("-", ["a11wild", Fn.select(0, Fn.split("-", stackUuid))]) },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.dashboardClient = this.userPool.addClient("DashboardClient", {
      generateSecret: false,
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${props.publicOrigin}/auth/callback`],
        logoutUrls: [`${props.publicOrigin}/`],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      idTokenValidity: Duration.minutes(5),
      accessTokenValidity: Duration.minutes(5),
      refreshTokenValidity: Duration.hours(1),
    });

    new cognito.CfnManagedLoginBranding(this, "DashboardLoginStyle", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.dashboardClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
  }
}
