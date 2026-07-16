# P3 distinctness profile (input-only, frozen in W12 WP1)

REPORT-only, unregistered. P3 (`staging-heldout-mesh`) is SELF-AUTHORED (scripts/generate-heldout-plan.mjs, seed 20260704): out-of-tuning-distribution transfer material, NOT an independently sampled held-out plan — R8-F4 stays open. Scale counts as ONE dimension. Cycles/degrees/paths are measured on RESOLVED TFD flow endpoints (the layout substrate), not raw tfd text.

| axis | P1 (staging-extended-localstack-v2) | P2 (staging-localstack) | P3 (staging-heldout-mesh) |
| --- | --- | --- | --- |
| resource_changes (scale — ONE dimension) | 1175 | 792 | 396 |
| module depth max | 3 | 3 | 5 |
| module depth histogram | {"0":298,"1":360,"2":424,"3":93} | {"0":116,"1":343,"2":240,"3":93} | {"1":157,"2":51,"3":112,"4":64,"5":12} |
| TFD resolved edges | 155 | 74 | 178 |
| TFD endpoints | 138 | 75 | 153 |
| out-degree p50/p90/max | 1/3/8 | 1/3/7 | 1/2/16 |
| SCCs (size >= 2) | [] | [] | [2,2,4] |
| path length p50/p90/max | 8/13/15 | 10/15/15 | 4/5/6 |
| distinct resource types | 98 | 68 | 19 |
| top types | aws_security_group_rule(76), aws_route_table_association(64), aws_subnet(64), aws_vpc_endpoint(63), aws_iam_role(59) | aws_security_group_rule(59), aws_route(50), aws_iam_role_policy(42), aws_iam_role(39), aws_cloudwatch_log_group(37) | aws_cloudwatch_log_group(53), aws_cloudwatch_metric_alarm(52), aws_sqs_queue(36), aws_iam_role(33), aws_iam_role_policy(33) |

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
