import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

// Must stay in sync with ORIGIN_SECRET_HEADER in backend/app/main.py.
const ORIGIN_SECRET_HEADER = "x-scalpbiome-origin";

export interface ScalpBiomeStackProps extends cdk.StackProps {
  /** WAF web ACL ARN from the us-east-1 stack. */
  readonly webAclArn: string;
  /** Hard ceiling on concurrent Lambda executions. */
  readonly reservedConcurrency: number;
}

/**
 * ScalpBiome: a public, single-origin static site plus inference API.
 *
 * Topology
 * --------
 *   CloudFront ──(default)──> S3 bucket (private, OAC)      static SPA
 *              └─(/api/*)──> Lambda function URL (private)  FastAPI inference
 *
 * Serving both from one distribution means the browser sees a single origin, so
 * the API needs no CORS headers at all and no cross-origin surface exists.
 *
 * Security posture
 * ----------------
 * The API is deliberately UNAUTHENTICATED: it is a conference demo with no user
 * accounts, no persistence, and no data to protect. What that leaves exposed is
 * compute cost and availability, so the controls target abuse rather than
 * confidentiality:
 *
 *   - WAF rate limiting per IP, plus AWS managed rule sets.
 *   - Reserved concurrency: a hard ceiling on simultaneous executions, which
 *     bounds both spend and blast radius even if WAF is bypassed.
 *   - Application-level input caps (upload size, row/column counts, request
 *     dimensions) enforced in the app itself, not just at the edge.
 *   - Neither origin is reachable directly: the S3 bucket is private behind OAC
 *     and the function URL requires a SigV4-signed request from this
 *     distribution specifically.
 *   - The execution role gets no permissions beyond writing its own logs. S3
 *     ingest is disabled, so there is nothing for a compromised handler to read.
 *   - No secrets, environment-injected credentials, or database exist.
 */
export class ScalpBiomeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ScalpBiomeStackProps) {
    super(scope, id, props);

    const repoRoot = path.join(__dirname, "..", "..");

    // -----------------------------------------------------------------------
    // Origin shared secret
    // -----------------------------------------------------------------------
    // CloudFront injects this header on origin requests and the application
    // refuses anything without it, so the publicly resolvable execute-api
    // endpoint cannot be used directly and all traffic must pass through
    // CloudFront (and therefore WAF).
    //
    // Scope of protection, stated plainly: this stops opportunistic scanning of
    // execute-api hostnames. It is NOT a credential. The value is readable by
    // anyone with CloudFront or CloudFormation read access in this account, and
    // it is derived deterministically so redeploys do not churn the
    // distribution. The endpoint exposes no data and holds no state, so this is
    // proportionate; a real secret would belong in Secrets Manager, which
    // CloudFront custom headers cannot resolve at request time.
    const originSecret =
      (this.node.tryGetContext("originSecret") as string | undefined) ??
      createHash("sha256")
        .update(`${this.account}:${this.region}:ScalpBiome:origin-v1`)
        .digest("base64url")
        .slice(0, 43);

    // -----------------------------------------------------------------------
    // Log buckets
    // -----------------------------------------------------------------------
    // Separate bucket for access logs. S3 refuses to let a bucket log to itself,
    // and keeping logs apart means the site bucket policy stays minimal.
    const logBucket = new s3.Bucket(this, "LogBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront's log delivery writes with ACLs, so this bucket needs
      // ownership settings that permit them.
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        // Bound retention so a public demo cannot accumulate storage cost.
        { expiration: cdk.Duration.days(30) },
      ],
    });

    // -----------------------------------------------------------------------
    // Static site bucket: private, reachable only through CloudFront
    // -----------------------------------------------------------------------
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // No public website hosting: the only reader is CloudFront via OAC.
      publicReadAccess: false,
      versioned: false,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: "s3-access/",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------------------------
    // Inference Lambda
    // -----------------------------------------------------------------------
    // A zip package rather than a container image. Dropping pandas brought the
    // dependency tree to ~179 MB stripped, under Lambda's 250 MB limit, which
    // removes the Docker requirement entirely: pip cross-downloads Linux/arm64
    // wheels from any host. Zip packages also cold-start faster than images.
    const apiFunction = new lambda.Function(this, "ApiFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(repoRoot, "backend"), {
        // Excluded from the asset hash so unrelated local files do not force a
        // rebuild, and so the build output is never nested inside its own input.
        exclude: [
          ".venv",
          "build",
          "__pycache__",
          "*.pyc",
          "sample_data",
          "verify.py",
          "run.sh",
        ],
        bundling: {
          // `local` runs on the host and returns true on success, in which case
          // CDK never touches Docker. The image below is only a fallback for
          // environments without a working local toolchain.
          image: cdk.DockerImage.fromRegistry(
            "public.ecr.aws/sam/build-python3.12:latest"
          ),
          command: [
            "bash",
            "-c",
            "./build-lambda-package.sh /asset-output",
          ],
          local: {
            tryBundle(outputDir: string): boolean {
              const script = path.join(repoRoot, "backend", "build-lambda-package.sh");
              const result = spawnSync("bash", [script, outputDir], {
                cwd: path.join(repoRoot, "backend"),
                stdio: ["ignore", "inherit", "inherit"],
              });
              if (result.error || result.status !== 0) {
                // Returning false lets CDK fall back to Docker bundling rather
                // than failing outright.
                return false;
              }
              return true;
            },
          },
        },
      }),
      architecture: lambda.Architecture.ARM_64,
      // 2 GB buys proportionally more CPU, which matters because cold start is
      // dominated by importing scikit-learn/pandas and training the model.
      memorySize: 2048,
      timeout: cdk.Duration.seconds(29),
      // Hard ceiling: bounds cost and blast radius independently of WAF.
      reservedConcurrentExecutions: props.reservedConcurrency,
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        // Input bounds enforced in the application, mirroring settings.py.
        SCALPBIOME_MAX_UPLOAD_BYTES: "262144",
        SCALPBIOME_MAX_ROWS: "2000",
        SCALPBIOME_MAX_SAMPLE_COLUMNS: "50",
        SCALPBIOME_MAX_ABUNDANCE_KEYS: "500",
        SCALPBIOME_MAX_TRAJECTORY_STEPS: "60",
        // Same-origin through CloudFront, so no cross-origin access is granted.
        SCALPBIOME_ALLOW_LOCALHOST_CORS: "false",
        SCALPBIOME_CORS_ORIGINS: "",
        // Reading arbitrary S3 URIs stays off. The execution role has no S3
        // permissions either, so this is defence in depth rather than the only
        // control.
        SCALPBIOME_ENABLE_S3_INGEST: "false",
        // In-process only: no network, no credentials.
        SCALPBIOME_ENABLE_HEALTHOMICS_DEMO: "true",
        // Must match the header CloudFront injects, or every request is refused.
        SCALPBIOME_ORIGIN_SECRET: originSecret,
      },
    });

    // -----------------------------------------------------------------------
    // API Gateway HTTP API in front of the function
    // -----------------------------------------------------------------------
    // Chosen over a Lambda function URL with CloudFront OAC.
    //
    // OAC for function URLs was tried first and CloudFront's SigV4-signed
    // requests were rejected with a 403 from the function URL authorizer. That
    // was verified not to be the resource policy (an unconditional allow for
    // cloudfront.amazonaws.com still failed), not the Host or Authorization
    // header forwarding, not compression, and not the documented
    // permission-before-OAC ordering. The function itself was fine throughout:
    // a directly SigV4-signed request returned 200.
    //
    // An HTTP API with a Lambda proxy integration is the pattern already running
    // in this account, so it is the known-good choice rather than a guess.
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "scalpbiome-api",
      description: "ScalpBiome inference API (reached only via CloudFront).",
      // No CORS configuration: the browser talks to CloudFront, which serves the
      // SPA and the API from one origin, so requests are never cross-origin.
      defaultIntegration: new apigwv2Integrations.HttpLambdaIntegration(
        "ApiIntegration",
        apiFunction
      ),
    });

    // Access logging on the default stage. The L2 HttpStage does not surface
    // accessLogSettings, so this reaches through to the L1 resource.
    //
    // The format deliberately records only request metadata: no headers, no
    // bodies, no query strings. Uploaded abundance tables could be a
    // researcher's unpublished data, and none of it belongs in a log.
    const apiAccessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const defaultStage = httpApi.defaultStage?.node
      .defaultChild as apigwv2.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: apiAccessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        requestTime: "$context.requestTime",
        httpMethod: "$context.httpMethod",
        routeKey: "$context.routeKey",
        path: "$context.path",
        status: "$context.status",
        protocol: "$context.protocol",
        responseLength: "$context.responseLength",
        integrationErrorMessage: "$context.integrationErrorMessage",
      }),
    };

    // The execute-api hostname, without scheme, for use as a CloudFront origin.
    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`;

    // -----------------------------------------------------------------------
    // Security headers
    // -----------------------------------------------------------------------
    const responseHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeaders",
      {
        comment: "ScalpBiome security headers",
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            override: true,
            // Everything is same-origin: no CDNs, no webfonts, no analytics.
            //
            // 'unsafe-inline' appears for style-src only. React inline styles and
            // Recharts both emit style attributes, so it cannot be avoided
            // without abandoning the charting library. script-src stays strictly
            // 'self' with no inline or eval, which is the directive that actually
            // mitigates XSS.
            contentSecurityPolicy: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          strictTransportSecurity: {
            override: true,
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            preload: false,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            override: true,
            frameOption: cloudfront.HeadersFrameOption.DENY,
          },
          referrerPolicy: {
            override: true,
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          },
          xssProtection: { override: true, protection: true, modeBlock: true },
        },
        customHeadersBehavior: {
          customHeaders: [
            // Opt out of Chrome's interest-cohort/topics inference.
            {
              header: "Permissions-Policy",
              value: "geolocation=(), microphone=(), camera=(), browsing-topics=()",
              override: true,
            },
          ],
        },
      }
    );

    // -----------------------------------------------------------------------
    // CloudFront distribution
    // -----------------------------------------------------------------------
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "ScalpBiome public demo",
      defaultRootObject: "index.html",
      webAclId: props.webAclArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // NOTE: minimumProtocolVersion is deliberately NOT set here.
      //
      // With the default *.cloudfront.net certificate, CloudFront pins the
      // security policy to TLSv1 and silently ignores the setting, so specifying
      // TLS_V1_2_2021 would imply a guarantee that does not hold. Modern browsers
      // still negotiate TLS 1.2/1.3, but older clients would be accepted.
      //
      // Raising the floor requires a custom domain with an ACM certificate. See
      // the README for that path; it is the one security control this stack
      // cannot enforce without a domain.
      enableLogging: true,
      logBucket,
      logFilePrefix: "cloudfront/",
      // Do not log query strings: nothing here needs them and it avoids
      // retaining request detail unnecessarily.
      logIncludesCookies: false,

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: responseHeaders,
        compress: true,
      },

      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            // Injected on every origin request; the application rejects requests
            // without it, making CloudFront the only usable route to the API.
            customHeaders: {
              [ORIGIN_SECRET_HEADER]: originSecret,
            },
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // The API accepts POST for analyze, trajectory and upload.
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          // Inference responses must never be cached: the same URL returns
          // different results depending on the request body, so a shared cache
          // could serve one caller's analysis to another.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Host is excluded because API Gateway rejects a Host header that does
          // not match its own domain.
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: responseHeaders,
          compress: true,
        },
      },

      // NO custom error responses.
      //
      // The usual SPA pattern maps 403/404 to /index.html so client-side routes
      // resolve. This app is a single page with no router, so it gains nothing
      // from that, and it actively causes harm: custom error responses apply to
      // the WHOLE distribution, including /api/*. Any API 403 or 404 would be
      // rewritten into the HTML shell with status 200, which both breaks clients
      // and hides real failures during debugging.
      //
      // Leaving them off means S3 404s surface as 404 and API errors surface as
      // themselves, which is the correct behaviour in both cases.
    });

    // -----------------------------------------------------------------------
    // Publish the built frontend
    // -----------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "frontend", "dist"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      prune: true,
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Public URL for the ScalpBiome demo.",
    });
    new cdk.CfnOutput(this, "ApiHealthUrl", {
      value: `https://${distribution.distributionDomainName}/api/health`,
      description: "Health endpoint, useful for a quick smoke test.",
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution id (for manual invalidations).",
    });
  }
}
