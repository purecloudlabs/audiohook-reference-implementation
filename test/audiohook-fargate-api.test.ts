import { Template } from 'aws-cdk-lib/assertions';
import { App } from 'aws-cdk-lib';
import * as AudiohookFargateStack from '../lib/audiohook-fargate-stack';

test.skip('Empty Stack', () => {
    const app = new App();
    // WHEN
    const stack = new AudiohookFargateStack.AudiohookFargateStack(app, 'MyTestStack', {
        deployEnvironment: 'test',
        hostedZoneName: 'example.com',
        applicationDomain: 'api.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000',
        taskParams: {
            cpu: 1024,
            memoryLimitMiB: 2048
        },
        autoScalingParams: {
            minCapacity: 2,
            maxCapacity: 5,
            targetUtilizationPercent: 50
        },
        env: {
            account: '000000000000',
            region: 'us-east-1'
        }
    });
    // THEN
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::ECS::Service', {
        LaunchType: 'FARGATE'
    });
});
