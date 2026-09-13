#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { ScalpBiomeStack } from "../lib/scalpbiome-stack.js";
import { WafStack } from "../lib/waf-stack.js";

const app = new cdk.App();

// Account comes from the ambient credentials; region is pinned.
const account =
  process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;

// ap-southeast-1 (Singapore): keeps the workload in-region alongside SCELSE.
const APP_REGION = "ap-southeast-1";

// A web ACL scoped to CLOUDFRONT must live in us-east-1, whatever region the
// rest of the workload uses.
const WAF_REGION = "us-east-1";

const wafStack = new WafStack(app, "ScalpBiomeWaf", {
  env: { account, region: WAF_REGION },
  description:
    "WAF web ACL for the ScalpBiome CloudFront distribution (must be us-east-1).",
  // 600 requests per 5 minutes per IP. Generous for a human clicking through the
  // demo, restrictive enough to stop a script driving up inference cost.
  rateLimitPerIp: 600,
  crossRegionReferences: true,
});

const appStack = new ScalpBiomeStack(app, "ScalpBiome", {
  env: { account, region: APP_REGION },
  description:
    "ScalpBiome public demo: CloudFront + private S3 site + Lambda inference API.",
  webAclArn: wafStack.webAclArn,
  // Caps concurrent inference. Well above demo needs, far below anything that
  // could run up a meaningful bill.
  reservedConcurrency: 20,
  crossRegionReferences: true,
});

// The app stack consumes the web ACL ARN, so WAF must exist first. This also
// fixes the destroy order: tear down ScalpBiome before ScalpBiomeWaf.
appStack.addStackDependency(wafStack);

// ---------------------------------------------------------------------------
// Security validation
// ---------------------------------------------------------------------------
// cdk-nag runs the AWS Solutions ruleset against both stacks at synth time, so
// misconfigurations surface before anything is deployed.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Suppressions below are deliberate decisions, each with a reason. Anything not
// listed here is expected to pass.
NagSuppressions.addStackSuppressions(appStack, [
  {
    id: "AwsSolutions-IAM4",
    reason:
      "The Lambda execution role uses AWSLambdaBasicExecutionRole, which grants " +
      "only CloudWatch Logs write access. Hand-rolling an equivalent policy adds " +
      "maintenance burden without reducing privilege.",
  },
  {
    id: "AwsSolutions-IAM5",
    reason:
      "Wildcards are confined to CDK-managed constructs: the BucketDeployment " +
      "custom resource needs object-level access across the site bucket keyspace, " +
      "and log writes target a log stream wildcard within the function's own log " +
      "group. Both are scoped to resources created by this stack.",
  },
  {
    id: "AwsSolutions-L1",
    reason:
      "The BucketDeployment and log-retention custom resources are CDK-managed " +
      "and pin their own runtimes. The application function is a container image " +
      "on the Python 3.12 Lambda base image, which this rule does not inspect.",
  },
  {
    id: "AwsSolutions-S1",
    reason:
      "The log bucket intentionally has no server access logging of its own; " +
      "logging a log bucket to itself is rejected by S3 and logging it elsewhere " +
      "creates an unbounded chain. The site bucket does log to it.",
  },
  {
    id: "AwsSolutions-CFR4",
    reason:
      "Using the default CloudFront certificate, which pins the minimum protocol " +
      "to TLSv1 at the API level even though the distribution is configured for " +
      "TLS_V1_2_2021. Overriding it requires a custom domain and ACM certificate, " +
      "which this demo deliberately does not provision.",
  },
  {
    id: "AwsSolutions-CFR1",
    reason:
      "No geo restriction. The audience is international and the endpoint exposes " +
      "no data worth region-fencing.",
  },
  {
    id: "AwsSolutions-CFR3",
    reason:
      "Access logging IS enabled on the distribution; this rule does not detect " +
      "the logBucket/logFilePrefix form used here.",
  },
  {
    id: "AwsSolutions-APIG4",
    reason:
      "The API is intentionally unauthenticated: a public conference demo with " +
      "no accounts, no persistence, and no data to protect. Abuse is addressed " +
      "instead of authentication: WAF rate limiting on the distribution, Lambda " +
      "reserved concurrency as a hard ceiling, application-level input bounds, " +
      "and a CloudFront-injected origin header that the application requires, " +
      "so the execute-api endpoint cannot be driven directly.",
  },
  {
    id: "AwsSolutions-APIG2",
    reason:
      "Request validation is performed by Pydantic models in the application " +
      "rather than by API Gateway. The handler is a proxy integration for a " +
      "FastAPI app, so schema definitions live with the code that uses them.",
  },
]);

NagSuppressions.addStackSuppressions(wafStack, [
  {
    id: "AwsSolutions-IAM4",
    reason: "No IAM roles are created by this stack beyond CDK defaults.",
  },
]);

app.synth();
