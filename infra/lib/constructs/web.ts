import { existsSync } from "node:fs";
import path from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

const WEB_DIST = path.join(import.meta.dirname, "../../../web/dist");

/** Paths that go to the API. Everything else is the dashboard. */
export const API_PATHS = ["/mcp", "/api/*", "/auth/*", "/.well-known/*"] as const;

/** Pictures come from the studio's own private bucket, through links that the API signs for a short time. */
const contentSecurityPolicy = (picturesDomainName: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${picturesDomainName}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

export interface WebProps {
  apiOriginDomainName: string;
  /** The regional host name of the pictures bucket: the only other host the dashboard may load a picture from. */
  picturesDomainName: string;
}

/** The one public origin: dashboard files from a private bucket, API paths to the HTTP API. */
export class Web extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    const bucket = new s3.Bucket(this, "Files", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Holds only build output, which every deploy writes again.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        contentSecurityPolicy: { contentSecurityPolicy: contentSecurityPolicy(props.picturesDomainName), override: true },
      },
    });

    // Dashboard routes such as /connections have no file; they all load index.html.
    // Distribution-wide error pages are not used: they would hide API errors.
    const spaRoutes = new cloudfront.Function(this, "SpaRoutes", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        [
          "function handler(event) {",
          "  var request = event.request;",
          "  var last = request.uri.split('/').pop();",
          "  if (last.indexOf('.') === -1) request.uri = '/index.html';",
          "  return request;",
          "}",
        ].join("\n"),
      ),
    });

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.HttpOrigin(props.apiOriginDomainName),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: securityHeaders,
    };

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "a11-wild studio",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [{ function: spaRoutes, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: Object.fromEntries(API_PATHS.map((pattern) => [pattern, apiBehavior])),
    });

    // A synth with no dashboard build (tests, a first look) still works.
    if (existsSync(WEB_DIST)) {
      new s3deploy.BucketDeployment(this, "Deploy", {
        sources: [s3deploy.Source.asset(WEB_DIST)],
        destinationBucket: bucket,
        distribution: this.distribution,
        cacheControl: [s3deploy.CacheControl.fromString("public, max-age=300")],
      });
    }
  }

  get publicOrigin(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}
