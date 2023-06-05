import { Construct } from 'constructs';
import {
    Duration,
    RemovalPolicy,
    Stack,
    StackProps,
    CfnOutput,
    aws_certificatemanager as certificatemanager,
    aws_dynamodb as dynamodb,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecsPatterns,
    aws_ecr_assets as ecrAssets,
    aws_elasticloadbalancingv2 as elbv2,
    aws_logs as logs,
    aws_route53 as route53,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager
} from 'aws-cdk-lib';
import * as path from 'path';

export interface AudiohookFargateStackProps extends StackProps {
    readonly deployEnvironment: string;
    readonly hostedZoneName: string;
    readonly applicationDomain: string;
    readonly certificateArn?: string;
    readonly secretName?: string;
    readonly staticApiKeyMap?: string;
    readonly useDefaultVpc?: boolean;
    readonly taskParams: {
        readonly cpu: number;
        readonly memoryLimitMiB: number;
    },
    readonly autoScalingParams: {
        readonly minCapacity: number;
        readonly maxCapacity?: number;
        readonly targetUtilizationPercent?: number;
    }
}

export class AudiohookFargateStack extends Stack {
    constructor(scope: Construct, id: string, props: AudiohookFargateStackProps) {
        super(scope, id, props);

        // Not using the default VPC creates a new VPC with 2 AZs and two NAT Gateways -- Pricey!
        // That's why we use the default VPC by, well, default...
        const useDefaultVpc = props.useDefaultVpc ?? true;

        // Create an S3 bucket where we will be storing the WAV recordings and sidecar files
        // By default we keep them for 2 weeks.
        const recordingsBucket = new s3.Bucket(this, 'recordings', {
            lifecycleRules: [{
                id: 'keep-2-weeks',
                expiration: Duration.days(14)
            }],
            removalPolicy: RemovalPolicy.RETAIN,
        });

        // DynamoDB table for config, externalized session state, and other stuff
        const dbTable = new dynamodb.Table(this, 'data', {
            partitionKey: {
                name: 'PK',
                type: dynamodb.AttributeType.STRING
            }, 
            sortKey: {
                name: 'SK',
                type: dynamodb.AttributeType.STRING
            },
            timeToLiveAttribute: 'ttl',
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });
        dbTable.addGlobalSecondaryIndex({
            indexName: 'GSI1',
            partitionKey: {
                name: 'GSI1PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'GSI1SK',
                type: dynamodb.AttributeType.STRING
            },
            projectionType: dynamodb.ProjectionType.ALL,    // Not efficient--but simple
        });


        const hostedZone = route53.HostedZone.fromLookup(this, 'hosted-zone', {
            domainName: props.hostedZoneName
        });

        let certificate: certificatemanager.ICertificate; 
        if(props.certificateArn) {
            certificate = certificatemanager.Certificate.fromCertificateArn(this, 'certificate', props.certificateArn);
        } else {
            certificate = new certificatemanager.DnsValidatedCertificate(this, 'certificate', {
                hostedZone,
                domainName: props.applicationDomain
            });
        }

        const secret = props.secretName ? secretsmanager.Secret.fromSecretNameV2(this, 'secret', props.secretName) : null;

        const vpc = useDefaultVpc ? (
            ec2.Vpc.fromLookup(this, 'default-vpc', {
                isDefault: true
            })
        ) : undefined;

        const cluster = new ecs.Cluster(this, 'app-cluster', {
            vpc     // Specifying an undefined VPC creates a new VPC with 2 AZs (and two NAT gateways!)
        });

        const dockerImage = new ecrAssets.DockerImageAsset(this, 'app-image', {
            directory: path.join(__dirname, '../app')
        });

        const logGroup = new logs.LogGroup(this, 'logs', {
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'service', {
            cluster,
            certificate,
            domainName: props.applicationDomain,
            domainZone: hostedZone,
            loadBalancerName: 'audiohook-fargate-lb', 
            assignPublicIp: useDefaultVpc,  // Need public IP if in default VPC (https://stackoverflow.com/questions/61265108/aws-ecs-fargate-resourceinitializationerror-unable-to-pull-secrets-or-registry)
            taskImageOptions: {
                image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
                environment: {
                    'SERVERPORT': '8080',
                    'RECORDING_S3_BUCKET': recordingsBucket.bucketName,
                    'DYNAMODB_TABLE_NAME': dbTable.tableName,
                    ...(secret ? { 'SECRET_NAME_OR_ARN': secret.secretFullArn ?? secret.secretArn } : {}),
                    ...(props.staticApiKeyMap ? { 'STATIC_API_KEY_MAP': props.staticApiKeyMap } : {})
                },
                containerPort: 8080,
                logDriver: new ecs.AwsLogDriver({
                    streamPrefix: 'task',
                    logGroup
                })
            },
            propagateTags: ecs.PropagatedTagSource.SERVICE,
            redirectHTTP: true,
            desiredCount: props.autoScalingParams.minCapacity,
            ...props.taskParams,
        });

        // Allow our container to access the S3 bucket to dump the recordings,
        recordingsBucket.grantReadWrite(fargateService.taskDefinition.taskRole);

        // the DynamoDB table,
        dbTable.grantReadWriteData(fargateService.taskDefinition.taskRole);

        // and read the secret
        secret?.grantRead(fargateService.taskDefinition.taskRole);

        // Create an auto scaling target group
        if(props.autoScalingParams.minCapacity !== (props.autoScalingParams.maxCapacity ?? props.autoScalingParams.minCapacity)) {
            const autoScalingGroup = fargateService.service.autoScaleTaskCount({
                minCapacity: props.autoScalingParams.minCapacity,
                maxCapacity: props.autoScalingParams.maxCapacity ?? props.autoScalingParams.minCapacity,
            });
            autoScalingGroup.scaleOnCpuUtilization('cpu-scaling', {
                targetUtilizationPercent: props.autoScalingParams.targetUtilizationPercent ?? 50,
                scaleInCooldown: Duration.seconds(60),
                scaleOutCooldown: Duration.seconds(60),
            });
        }

        fargateService.targetGroup.configureHealthCheck({
            enabled: true,
            path: '/health/check',
            healthyHttpCodes: '200',
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 2,
            timeout: Duration.seconds(4),
            interval: Duration.seconds(10)
        });

        // As we have WebSocket sessions, this needs to be longer
        // TODO:
        //  - Currently short for development to keep deployment time short
        //  - Revisit once reconnect feature in AudioHook is implemented.
        //  - Need ASG lifecycle handling (lifecycle hook)
        fargateService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '180'); 

        // Forward requests with our application domain as host header and API requests (whitelisted paths) to target.
        fargateService.listener.addAction(
            'forward-to-fargate',
            {
                priority: 100,
                action: elbv2.ListenerAction.forward([fargateService.targetGroup]),
                conditions: [
                    elbv2.ListenerCondition.hostHeaders([props.applicationDomain]),
                    elbv2.ListenerCondition.pathPatterns([
                        '/api/v1/*',
                    ]),
                ]
            }
        );

        // All other requests to application domain are 404'd
        // NOTE: This hides the /health/check endpoint from the outside too!
        fargateService.listener.addAction(
            'non-api-path-404',
            {
                priority: 200,
                action: elbv2.ListenerAction.fixedResponse(404, {
                    contentType: 'application/json',
                    messageBody: '{"status":404,"message":"Resource not found"}'
                }),
                conditions: [
                    elbv2.ListenerCondition.hostHeaders([props.applicationDomain]),
                ]
            }
        );

        // We want a catch-all default action that returns a fixed error response.
        // This prevents access through the DNS name of the ELB directly. 
        // Only allow access through the above listener action that matches host.
        // Using addAction as default rule (undefined priority) causes a warning. 
        // We have to use an escape hatch hack.
        const cfnListener = fargateService.listener.node.defaultChild as elbv2.CfnListener;
        cfnListener.defaultActions = [{
            type: 'fixed-response',
            fixedResponseConfig: {
                statusCode: '403',
                contentType: 'application/json',
                messageBody: '{"status":403,"message":"This is not a valid endpoint"}'
            }
        }];

        new CfnOutput(this, 'recordingBucketName', {
            value: recordingsBucket.bucketName,
        });

        new CfnOutput(this, 'dynamodbTableName', {
            value: dbTable.tableName,
        });

        new CfnOutput(this, 'logGroupName', {
            value: logGroup.logGroupName,
        });

        new CfnOutput(this, 'region', {
            value: Stack.of(this).region,
        });

    }
}
