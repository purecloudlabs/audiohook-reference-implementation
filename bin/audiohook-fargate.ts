#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import { AudiohookFargateStack } from '../lib/audiohook-fargate-stack';
import { config as dotenvConfig } from 'dotenv';
const configOut = dotenvConfig();
if(configOut.error) {
    console.error('Could not find .env file!');
    process.exit(1);
}

const requiredEnvVar = (name: string): string => {
    const val = process.env[name];
    if(!val) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return val;
};

const app = new App();
const stack = new AudiohookFargateStack(app, 'audiohook-fargate', {
    env: { 
        account: process.env['CDK_DEFAULT_ACCOUNT'], 
        region: process.env['CDK_DEFAULT_REGION']
    },
    deployEnvironment: 'dev',
    hostedZoneName: requiredEnvVar('HOSTED_ZONE_NAME'),
    applicationDomain: requiredEnvVar('APPLICATION_DOMAIN'),
    certificateArn: process.env['CERTIFICATE_ARN'],
    secretName: process.env['SECRET_NAME'],
    staticApiKeyMap: process.env['STATIC_API_KEY_MAP'],
    useDefaultVpc: true,
    taskParams: {
        cpu: 1024,
        memoryLimitMiB: 2048
    },
    autoScalingParams: {
        minCapacity: 1,
        maxCapacity: 3,
        targetUtilizationPercent: 50
    }
});

const projectName = process.env['npm_package_name'];
if(projectName) {
    Tags.of(stack).add('Project', projectName);
}

const tagOwner = process.env['TAG_OWNER'];
if(tagOwner) {
    Tags.of(stack).add('Owner', tagOwner);
}
