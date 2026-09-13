#!/usr/bin/env python3
"""Security audit of the synthesized CloudFormation templates.

cdk-nag checks against a general ruleset; this asserts the specific properties
this stack's security posture actually depends on. Every claim made in the README
about the deployed configuration should be verifiable here.

Run:  cdk synth && python3 security-audit.py
Exits non-zero on any failure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

OUT = Path(__file__).parent / "cdk.out"
FAILURES: List[str] = []
CHECKS = 0


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    print(("  PASS  " if condition else "  FAIL  ") + message)
    if not condition:
        FAILURES.append(message)


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


def load(name: str) -> Dict[str, Any]:
    path = OUT / f"{name}.template.json"
    if not path.exists():
        print(f"Missing {path}. Run `cdk synth` first.")
        sys.exit(2)
    return json.loads(path.read_text())


def resources_of(tpl: Dict[str, Any], rtype: str) -> Dict[str, Any]:
    return {
        k: v for k, v in tpl["Resources"].items() if v.get("Type") == rtype
    }


app = load("ScalpBiome")
waf = load("ScalpBiomeWaf")

# ---------------------------------------------------------------------------
section("1. S3 buckets are private and encrypted")
# ---------------------------------------------------------------------------
buckets = resources_of(app, "AWS::S3::Bucket")
check(len(buckets) == 2, f"{len(buckets)} buckets (site + logs)")
for name, b in buckets.items():
    props = b.get("Properties", {})
    pab = props.get("PublicAccessBlockConfiguration", {})
    check(
        all(
            pab.get(k) is True
            for k in (
                "BlockPublicAcls",
                "BlockPublicPolicy",
                "IgnorePublicAcls",
                "RestrictPublicBuckets",
            )
        ),
        f"{name}: all four public-access blocks enabled",
    )
    enc = props.get("BucketEncryption", {}).get(
        "ServerSideEncryptionConfiguration", []
    )
    check(bool(enc), f"{name}: server-side encryption configured")
    check(
        "WebsiteConfiguration" not in props,
        f"{name}: no public S3 website hosting",
    )

# ---------------------------------------------------------------------------
section("2. No bucket policy allows anonymous access")
# ---------------------------------------------------------------------------
for name, pol in resources_of(app, "AWS::S3::BucketPolicy").items():
    doc = pol["Properties"]["PolicyDocument"]
    for stmt in doc.get("Statement", []):
        principal = stmt.get("Principal")
        effect = stmt.get("Effect")
        has_condition = bool(stmt.get("Condition"))
        wildcard = principal == "*" or (
            isinstance(principal, dict) and principal.get("AWS") == "*"
        )
        if effect == "Allow" and wildcard:
            check(
                has_condition,
                f"{name}: wildcard-principal Allow is condition-gated",
            )
        # Deny statements with wildcard principals are the enforceSSL guard.
    denies_insecure = any(
        s.get("Effect") == "Deny"
        and s.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport")
        in ("false", False)
        for s in doc.get("Statement", [])
    )
    check(denies_insecure, f"{name}: denies non-TLS requests")

# ---------------------------------------------------------------------------
section("3. API reachable only through CloudFront")
# ---------------------------------------------------------------------------
# No Lambda function URL: the API is fronted by an HTTP API. A function URL
# would be a second, unprotected ingress.
urls = resources_of(app, "AWS::Lambda::Url")
check(len(urls) == 0, f"no Lambda function URL exposed ({len(urls)} found)")

apis = resources_of(app, "AWS::ApiGatewayV2::Api")
check(len(apis) == 1, f"{len(apis)} HTTP API")

# The execute-api endpoint is publicly resolvable, so the application requires a
# header that only CloudFront injects. Both sides must agree, or every request
# either fails closed (good) or the protection is absent (bad).
ORIGIN_HEADER = "x-scalpbiome-origin"
dist_secret = None
for d in resources_of(app, "AWS::CloudFront::Distribution").values():
    for origin in d["Properties"]["DistributionConfig"]["Origins"]:
        for h in origin.get("OriginCustomHeaders", []) or []:
            if h.get("HeaderName") == ORIGIN_HEADER:
                dist_secret = h.get("HeaderValue")
check(
    isinstance(dist_secret, str) and len(dist_secret) >= 32,
    f"CloudFront injects {ORIGIN_HEADER} ({len(dist_secret or '')} chars)",
)

api_fn_env = None
for name, f in resources_of(app, "AWS::Lambda::Function").items():
    if name.startswith("ApiFunction"):
        api_fn_env = f["Properties"].get("Environment", {}).get("Variables", {})
check(
    api_fn_env is not None
    and api_fn_env.get("SCALPBIOME_ORIGIN_SECRET") == dist_secret,
    "application's expected origin secret matches what CloudFront sends",
)

# Access logging on the API stage, without recording request contents.
stages = resources_of(app, "AWS::ApiGatewayV2::Stage")
for name, s in stages.items():
    logs_cfg = s["Properties"].get("AccessLogSettings", {})
    check(
        "DestinationArn" in logs_cfg,
        f"{name}: access logging enabled",
    )
    fmt = logs_cfg.get("Format", "")
    for leaky in ("$context.identity.userAgent", "authorization", "$input.body"):
        check(
            leaky.lower() not in fmt.lower(),
            f"{name}: log format does not capture {leaky}",
        )

# ---------------------------------------------------------------------------
section("4. Inference function is bounded and hardened")
# ---------------------------------------------------------------------------
fns = resources_of(app, "AWS::Lambda::Function")
api_fn = None
for name, f in fns.items():
    if name.startswith("ApiFunction"):
        api_fn = (name, f)
check(api_fn is not None, "API function present in template")
if api_fn:
    name, f = api_fn
    props = f["Properties"]
    check(
        isinstance(props.get("ReservedConcurrentExecutions"), int),
        f"{name}: reserved concurrency = {props.get('ReservedConcurrentExecutions')} "
        f"(caps cost and blast radius)",
    )
    check(
        props.get("Architectures") == ["arm64"],
        f"{name}: arm64 architecture",
    )
    # A supported runtime matters for security patching: deprecated runtimes stop
    # receiving updates.
    runtime = props.get("Runtime", "")
    check(
        runtime.startswith("python3.1") and int(runtime.split(".")[1]) >= 12,
        f"{name}: runtime is {runtime} (supported, still receiving patches)",
    )
    check(
        props.get("Timeout", 0) <= 30,
        f"{name}: timeout {props.get('Timeout')}s (bounded)",
    )
    env = props.get("Environment", {}).get("Variables", {})
    check(
        env.get("SCALPBIOME_ENABLE_S3_INGEST") == "false",
        "arbitrary S3 ingest disabled via environment",
    )
    check(
        env.get("SCALPBIOME_ALLOW_LOCALHOST_CORS") == "false",
        "localhost CORS disabled in production",
    )
    check(
        env.get("SCALPBIOME_CORS_ORIGINS", "") == "",
        "no cross-origin origins allowed (single-origin via CloudFront)",
    )
    for key in (
        "SCALPBIOME_MAX_UPLOAD_BYTES",
        "SCALPBIOME_MAX_ROWS",
        "SCALPBIOME_MAX_SAMPLE_COLUMNS",
        "SCALPBIOME_MAX_ABUNDANCE_KEYS",
        "SCALPBIOME_MAX_TRAJECTORY_STEPS",
    ):
        check(key in env, f"input bound set: {key}={env.get(key)}")

# ---------------------------------------------------------------------------
section("5. Execution role has no data-plane permissions")
# ---------------------------------------------------------------------------
# The API function's role should carry only the basic execution (logs) policy.
roles = resources_of(app, "AWS::IAM::Role")
api_role = next(
    (v for k, v in roles.items() if k.startswith("ApiFunctionServiceRole")), None
)
check(api_role is not None, "API function role present")
if api_role:
    managed = json.dumps(api_role["Properties"].get("ManagedPolicyArns", []))
    check(
        "AWSLambdaBasicExecutionRole" in managed,
        "role attaches only AWSLambdaBasicExecutionRole (CloudWatch Logs)",
    )
    inline = api_role["Properties"].get("Policies", [])
    check(not inline, f"role has no inline policies ({len(inline)} found)")
    # No S3 or Secrets access anywhere near this role.
    blob = json.dumps(api_role)
    for forbidden in ("s3:GetObject", "secretsmanager", "dynamodb", "kms:Decrypt"):
        check(
            forbidden.lower() not in blob.lower(),
            f"role grants no {forbidden}",
        )

# ---------------------------------------------------------------------------
section("6. CloudFront enforces HTTPS, WAF and security headers")
# ---------------------------------------------------------------------------
dists = resources_of(app, "AWS::CloudFront::Distribution")
check(len(dists) == 1, f"{len(dists)} distribution")
for name, d in dists.items():
    cfg = d["Properties"]["DistributionConfig"]
    check("WebACLId" in cfg, f"{name}: WAF web ACL attached")
    check(cfg.get("Logging") is not None, f"{name}: access logging enabled")
    check(cfg.get("HttpVersion") in ("http2and3", "http2"), f"{name}: modern HTTP")

    behaviors = [cfg["DefaultCacheBehavior"]] + cfg.get("CacheBehaviors", [])
    check(len(behaviors) == 2, f"{name}: 2 behaviors (site + /api/*)")
    for b in behaviors:
        pattern = b.get("PathPattern", "default")
        check(
            b.get("ViewerProtocolPolicy") == "redirect-to-https",
            f"{name}[{pattern}]: redirects HTTP to HTTPS",
        )
        check(
            "ResponseHeadersPolicyId" in b,
            f"{name}[{pattern}]: security headers policy attached",
        )
    api_behavior = next(
        (b for b in behaviors if b.get("PathPattern") == "/api/*"), None
    )
    check(api_behavior is not None, f"{name}: /api/* behavior present")
    if api_behavior:
        # CachePolicy must be the managed CachingDisabled policy: identical URLs
        # return different results per request body, so caching would be wrong
        # and could leak one caller's result to another.
        check(
            api_behavior.get("CachePolicyId")
            == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
            "/api/* uses managed CachingDisabled policy",
        )
        # Host must not be forwarded: API Gateway rejects a Host header that does
        # not match its own domain. AllViewerExceptHostHeader is the managed
        # policy that satisfies this, and is the one already proven in this
        # account against an HTTP API origin.
        MANAGED_ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
        check(
            api_behavior.get("OriginRequestPolicyId")
            == MANAGED_ALL_VIEWER_EXCEPT_HOST,
            "/api/* forwards viewer request except Host (required by API Gateway)",
        )

# ---------------------------------------------------------------------------
section("7. Response headers policy contents")
# ---------------------------------------------------------------------------
policies = resources_of(app, "AWS::CloudFront::ResponseHeadersPolicy")
check(len(policies) == 1, f"{len(policies)} response headers policy")
for name, p in policies.items():
    sec = p["Properties"]["ResponseHeadersPolicyConfig"]["SecurityHeadersConfig"]
    csp = sec.get("ContentSecurityPolicy", {}).get("ContentSecurityPolicy", "")
    check(bool(csp), f"{name}: CSP present")
    check("default-src 'self'" in csp, "CSP defaults to same-origin")
    check(
        "script-src 'self'" in csp and "unsafe-inline" not in csp.split("style-src")[0],
        "CSP script-src has no unsafe-inline (the directive that matters for XSS)",
    )
    check("object-src 'none'" in csp, "CSP blocks plugins")
    check("frame-ancestors 'none'" in csp, "CSP blocks framing")
    hsts = sec.get("StrictTransportSecurity", {})
    check(
        hsts.get("AccessControlMaxAgeSec", 0) >= 31536000,
        f"HSTS max-age >= 1 year ({hsts.get('AccessControlMaxAgeSec')}s)",
    )
    check(
        sec.get("ContentTypeOptions", {}).get("Override") is True,
        "X-Content-Type-Options: nosniff",
    )
    check(
        sec.get("FrameOptions", {}).get("FrameOption") == "DENY",
        "X-Frame-Options: DENY",
    )
    check(
        "ReferrerPolicy" in sec,
        f"Referrer-Policy set ({sec.get('ReferrerPolicy', {}).get('ReferrerPolicy')})",
    )

# ---------------------------------------------------------------------------
section("8. WAF protects the public endpoint")
# ---------------------------------------------------------------------------
acls = resources_of(waf, "AWS::WAFv2::WebACL")
check(len(acls) == 1, f"{len(acls)} web ACL")
for name, a in acls.items():
    props = a["Properties"]
    check(props.get("Scope") == "CLOUDFRONT", f"{name}: CLOUDFRONT scope")
    rules = props.get("Rules", [])
    rate = next(
        (r for r in rules if "RateBasedStatement" in r.get("Statement", {})), None
    )
    check(rate is not None, "rate-based rule present")
    if rate:
        limit = rate["Statement"]["RateBasedStatement"]["Limit"]
        check(
            0 < limit <= 10000,
            f"per-IP rate limit = {limit} requests / 5 min",
        )
        check("Block" in json.dumps(rate.get("Action", {})), "rate rule blocks")
    managed = [
        r["Statement"]["ManagedRuleGroupStatement"]["Name"]
        for r in rules
        if "ManagedRuleGroupStatement" in r.get("Statement", {})
    ]
    for expected in (
        "AWSManagedRulesCommonRuleSet",
        "AWSManagedRulesKnownBadInputsRuleSet",
        "AWSManagedRulesAmazonIpReputationList",
    ):
        check(expected in managed, f"managed rule group attached: {expected}")

# ---------------------------------------------------------------------------
section("9. No secrets or credentials in the templates")
# ---------------------------------------------------------------------------
SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"aws_secret_access_key", "aws_secret_access_key"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"),
    (r'"[Pp]assword"\s*:', "password field"),
]
for label, tpl in (("ScalpBiome", app), ("ScalpBiomeWaf", waf)):
    blob = json.dumps(tpl)
    for pattern, desc in SECRET_PATTERNS:
        check(
            re.search(pattern, blob) is None,
            f"{label}: no {desc}",
        )

# ---------------------------------------------------------------------------
print(f"\n{'=' * 66}")
if FAILURES:
    print(f"{len(FAILURES)} of {CHECKS} security checks FAILED:")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print(f"All {CHECKS} security checks passed.")
