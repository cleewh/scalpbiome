import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

export interface WafStackProps extends cdk.StackProps {
  /** Requests allowed per 5-minute window, per source IP. */
  readonly rateLimitPerIp: number;
}

/**
 * AWS WAF web ACL for the CloudFront distribution.
 *
 * This lives in its own stack because a web ACL with CLOUDFRONT scope MUST be
 * created in us-east-1, regardless of where the rest of the workload runs. The
 * application stack sits in ap-southeast-1 and consumes the ARN through a
 * cross-region reference.
 *
 * The API is intentionally unauthenticated (it is a public demo with no user
 * data), so rate limiting is the primary control against cost amplification and
 * abuse of the inference endpoint.
 */
export class WafStack extends cdk.Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: "scalpbiome-web-acl",
      description:
        "Rate limiting and managed rule protection for the ScalpBiome public demo.",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "scalpbiomeWebAcl",
        sampledRequestsEnabled: true,
      },
      rules: [
        // Primary control. The inference endpoint costs compute per call, so an
        // unauthenticated public API needs a hard per-IP ceiling.
        {
          name: "RateLimitPerIp",
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: props.rateLimitPerIp,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "rateLimitPerIp",
            sampledRequestsEnabled: true,
          },
        },
        // Broad protection against common exploit patterns.
        {
          name: "AwsCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
              // The upload endpoint legitimately receives CSV/TSV bodies, which
              // the generic body-size rule would otherwise flag. Application-level
              // caps already bound request size (see settings.py), so this rule is
              // redundant here and would only produce false positives.
              ruleActionOverrides: [
                {
                  name: "SizeRestrictions_BODY",
                  actionToUse: { count: {} },
                },
              ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "awsCommonRuleSet",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AwsKnownBadInputs",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "awsKnownBadInputs",
            sampledRequestsEnabled: true,
          },
        },
        // Blocks sources AWS associates with bots and malicious activity.
        {
          name: "AwsIpReputationList",
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "awsIpReputationList",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;

    new cdk.CfnOutput(this, "WebAclArn", {
      value: webAcl.attrArn,
      description: "WAF web ACL ARN consumed by the CloudFront distribution.",
    });
  }
}
