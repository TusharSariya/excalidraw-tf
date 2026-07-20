# Q7-AXIS direction-reading sheet — P2 (staging-localstack)

BLINDED sheet. For each edge, open the preset canvas, find the connection between the two named endpoints in the given region, and record which way it reads as flowing. Do NOT open the sealed key until every row is filled.

Proposition (per row): On the canvas, which way does this connection read as flowing? (A->B / B->A / ambiguous)

| # | endpoint A | endpoint B | canvas region | your read (A->B / B->A / ambiguous) |
| --- | --- | --- | --- | --- |
| 1 | aws_ecs_service.producer | module.ingress_queue.module.queue.aws_sqs_queue.this[0] | middle-left |  |
| 2 | aws_ecs_service.producer | aws_lb.ecs | top-left |  |
| 3 | module.api10.aws_api_gateway_rest_api.private | module.api10.module.lambda_service.module.lambda.aws_lambda_function.this[0] | top-right |  |
| 4 | module.api10_table.aws_dynamodb_table.this | module.api10.module.lambda_service.module.lambda.aws_lambda_function.this[0] | top-right |  |
| 5 | module.api11.aws_ecs_service.api | module.api11.aws_api_gateway_rest_api.private | top-right |  |
| 6 | module.api11.aws_ssm_parameter.api_name | module.api11.aws_ecs_service.api | top-right |  |
| 7 | module.api14_table.aws_dynamodb_table.this | module.api14.aws_ecs_service.api | bottom-right |  |
| 8 | module.api15.aws_ecs_service.api | module.api15.aws_api_gateway_rest_api.private | bottom-right |  |
| 9 | module.api15_aurora.aws_rds_cluster.this | module.api15.aws_ecs_service.api | bottom-right |  |
| 10 | module.api16.module.lambda_service.module.lambda.aws_lambda_function.this[0] | module.api16.aws_api_gateway_rest_api.private | bottom-right |  |
| 11 | module.api16.module.lambda_service.module.lambda.aws_lambda_function.this[0] | module.api16.aws_ssm_parameter.api_name | bottom-right |  |
| 12 | module.api2.aws_ssm_parameter.api_name | module.api2.aws_ecs_service.api | middle-center |  |
| 13 | module.api15.aws_api_gateway_rest_api.private | module.api6.module.lambda_service.module.lambda.aws_lambda_function.this[0] | middle-center |  |
| 14 | module.api7.aws_ecs_service.api | module.api7.aws_ssm_parameter.api_name | middle-center |  |
| 15 | module.api7.aws_ecs_service.api | module.api9.aws_api_gateway_rest_api.private | top-center |  |
| 16 | module.api9.aws_ecs_service.api | module.api9.aws_api_gateway_rest_api.private | top-right |  |
| 17 | module.api11.aws_api_gateway_rest_api.private | module.api9.aws_ecs_service.api | top-right |  |
| 18 | module.api9.aws_ssm_parameter.api_name | module.api9.aws_ecs_service.api | top-right |  |
| 19 | module.consumer_lambda.module.lambda.aws_lambda_function.this[0] | module.api2.aws_api_gateway_rest_api.private | middle-center |  |
| 20 | module.egress_queue.module.queue.aws_sqs_queue.this[0] | aws_ecs_service.egress | middle-center |  |
