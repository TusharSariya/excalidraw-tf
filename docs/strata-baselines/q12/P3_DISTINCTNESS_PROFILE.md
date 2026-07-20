# P3 distinctness profile (input-only, frozen in W12 WP1; v2 re-emitted under AMENDMENT-1)

FIXTURE v2 (AMENDMENT-1, strata-view-w12-heldout-scale.md): v1 had a single provider/account/region band (generator artifact, zero slice-B edges); v2 adds 3 account/region bands + cross-band fan-ins. v1 profile preserved at P3_DISTINCTNESS_PROFILE.v1.{json,md}. Thresholds/metrics/definitions unchanged.

REPORT-only, unregistered. P3 (`staging-heldout-mesh`) is SELF-AUTHORED (scripts/generate-heldout-plan.mjs, seed 20260704): out-of-tuning-distribution transfer material, NOT an independently sampled held-out plan — R8-F4 stays open. Scale counts as ONE dimension. Cycles/degrees/paths are measured on RESOLVED TFD flow endpoints (the layout substrate), not raw tfd text.

| axis | P1 (staging-extended-localstack-v2) | P2 (staging-localstack) | P3 (staging-heldout-mesh) |
| --- | --- | --- | --- |
| resource_changes (scale — ONE dimension) | 1175 | 792 | 399 |
| module depth max | 3 | 3 | 5 |
| module depth histogram | {"0":298,"1":360,"2":424,"3":93} | {"0":116,"1":343,"2":240,"3":93} | {"1":160,"2":51,"3":112,"4":64,"5":12} |
| TFD resolved edges | 155 | 74 | 210 |
| TFD endpoints | 138 | 75 | 155 |
| out-degree p50/p90/max | 1/3/8 | 1/3/7 | 1/3/16 |
| SCCs (size >= 2) | [] | [] | [2,2,4] |
| path length p50/p90/max | 8/13/15 | 10/15/15 | 4/5/6 |
| bands (account/region, from after.arn) | {"unbanded":623,"000000000004/us-east-1":14,"000000000003/us-east-1":72,"000000000002/us-east-1":167,"000000000003/us-west-2":33,"000000000002/us-east-2":63,"000000000002/us-west-2":88,"000000000002/us-west-1":54,"000000000003/us-east-2":34,"000000000003/us-west-1":27} | {"unbanded":420,"000000000000/us-east-1":159,"000000000000/us-east-2":66,"000000000000/us-west-2":91,"000000000000/us-west-1":56} | {"000000000000/us-east-1":309,"210987654321/us-east-1":48,"000000000000/us-west-2":42} |
| cross-band resolved edges (v2 slice-B material) | 3 | 0 | 39 |
| distinct resource types | 98 | 68 | 19 |
| top types | aws_security_group_rule(76), aws_route_table_association(64), aws_subnet(64), aws_vpc_endpoint(63), aws_iam_role(59) | aws_security_group_rule(59), aws_route(50), aws_iam_role_policy(42), aws_iam_role(39), aws_cloudwatch_log_group(37) | aws_cloudwatch_log_group(54), aws_cloudwatch_metric_alarm(52), aws_sqs_queue(36), aws_iam_role(33), aws_iam_role_policy(33) |

## Distinctness verdict

```json
{
  "nonScaleAxesDistinctFromBoth": [
    "moduleDepthMax",
    "sccCountGe2",
    "maxOutDegree",
    "pathLengthP90",
    "topTypeMixJaccard"
  ],
  "required": 3,
  "axes": {
    "moduleDepthMax": {
      "p1": 3,
      "p2": 3,
      "p3": 5,
      "distinctFromBoth": true
    },
    "sccCountGe2": {
      "p1": 0,
      "p2": 0,
      "p3": 3,
      "distinctFromBoth": true
    },
    "maxOutDegree": {
      "p1": 8,
      "p2": 7,
      "p3": 16,
      "distinctFromBoth": true
    },
    "pathLengthP90": {
      "p1": 13,
      "p2": 15,
      "p3": 5,
      "distinctFromBoth": true
    },
    "topTypeMixJaccard": {
      "p1": 0.18,
      "p2": 0.18,
      "p3": "reference",
      "distinctFromBoth": true
    }
  }
}
```
