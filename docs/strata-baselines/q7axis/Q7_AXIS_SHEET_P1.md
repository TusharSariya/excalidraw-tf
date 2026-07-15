# Q7-AXIS direction-reading sheet — P1 (staging-extended-localstack-v2)

BLINDED sheet. For each edge, open the preset canvas, find the connection between the two named endpoints in the given region, and record which way it reads as flowing. Do NOT open the sealed key until every row is filled.

Proposition (per row): On the canvas, which way does this connection read as flowing? (A->B / B->A / ambiguous)

| # | endpoint A | endpoint B | canvas region | your read (A->B / B->A / ambiguous) |
| --- | --- | --- | --- | --- |
| 1 | aws_ecs_service.producer | module.ingress_queue.module.queue.aws_sqs_queue.this[0] | top-left |  |
| 2 | aws_s3_bucket.lake["raw"] | aws_glue_crawler.raw | middle-center |  |
| 3 | aws_kinesis_stream.provisioned | aws_sns_topic.ops | bottom-right |  |
| 4 | module.regional_rds_east.aws_db_instance.this | aws_lambda_function.regional_writer_east | bottom-right |  |
| 5 | aws_config_configuration_recorder.this | aws_organizations_account.security | bottom-center |  |
| 6 | aws_ecs_service.producer | aws_organizations_account.workload | middle-left |  |
| 7 | aws_lb.ecs | aws_organizations_account.workload | middle-left |  |
| 8 | aws_cloudtrail.organization | aws_s3_bucket.lake["raw"] | bottom-right |  |
| 9 | module.regional_rds_west.aws_db_instance.this | aws_sqs_queue.regional_writer_west | bottom-right |  |
| 10 | aws_lb.ecs | aws_wafv2_web_acl.api | top-left |  |
| 11 | module.api1.module.lambda_service.module.lambda.aws_lambda_function.this[0] | module.api1.aws_ssm_parameter.api_name | top-center |  |
| 12 | module.api2_rds.aws_db_instance.this | module.api2.aws_ecs_service.api | top-center |  |
| 13 | module.api5_table.aws_dynamodb_table.this | module.api5.aws_ecs_service.api | top-center |  |
| 14 | module.api6.aws_api_gateway_rest_api.private | module.api6.module.lambda_service.module.lambda.aws_lambda_function.this[0] | top-center |  |
| 15 | module.api7.aws_ecs_service.api | module.api7_aurora.aws_rds_cluster.this | top-right |  |
| 16 | module.api9.aws_api_gateway_rest_api.private | module.api7.aws_ecs_service.api | middle-right |  |
| 17 | module.api8.aws_ecs_service.api | module.api8.aws_api_gateway_rest_api.private | middle-right |  |
| 18 | module.api8.aws_ssm_parameter.api_name | module.api8.aws_ecs_service.api | middle-right |  |
| 19 | module.api9.aws_ecs_service.api | module.api11.aws_api_gateway_rest_api.private | middle-right |  |
| 20 | module.egress_queue.module.queue.aws_sqs_queue.this[0] | aws_ecs_service.egress | top-center |  |
