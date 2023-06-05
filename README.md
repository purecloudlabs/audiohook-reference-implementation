# Genesys AudioHook Sample Service

## Introduction

This repo contains code to showcase a simple service that implements the [Genesys AudioHook protocol](https://developer.genesys.cloud/devapps/audiohook).
The service is implemented as container hosted on [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/userguide/what-is-fargate.html) and is written in [TypeScript](https://www.typescriptlang.org/) using the [Fastify](https://www.fastify.io/) framework. 

> **IMPORTANT**
> 
> The code in this repository is provided as a sample blueprint to get started building an AudioHook server and test protocol compliance.
> It does not include some of the robustness and resiliency patterns that you will likely require for a production quality service.
> 

## Architecture


![Architecture Diagram](doc/architecture.drawio.svg)


## Installation

### Prerequisites

 - AWS Account with necessary privileges to deploy the application.
 - Note: The Genesys Cloud AudioHook client will only establish connections to hosts that provide a certificate signed by public CA. Self-signed certificates are not supported. Connections to the ALB DNS name will not work due to certificate CN/SAN mismatch and an explicit host header check in ALB listener rule.
 - the latest LTS version of NodeJS (16+)
 - If AWS CDK is installed globally, it must be at the latest version.
 - Docker


### Setup

Clone repository and fetch submodules (structured field test data used as part of AudioHook library HTTP signature test):

```
git clone --recurse-submodules <repository>
```

Change into `audiohook-fargate` directory and run:

```
npm run setup
```

Add a `.env` file with the following variables in the root of the project:

| Environment Variable | Description |
| ---- | ---------- |
| `HOSTED_ZONE_NAME` | Required. Domain of the hosted zone, e.g. `example.com` |
| `APPLICATION_DOMAIN` | Required. Fully qualified domain name to use for the application load balancer endpoint, e.g. `audiohook.example.com` |
| `CERTIFICATE_ARN` | ARN of the certificate to use. If not specified, a new certificate for `APPLICATION_DOMAIN` will be created. Certificate Manager [DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html) will be used and requires the appropriate permissions. |
| `SECRET_NAME` | Name of a secret stored in Amazon Secrets Manager that contains the client secrets for the respective API Keys. The Secret Key represent represents the API key and the Secret Value the (base-64 encoded) client secret. An empty secret value means the API key does not use a client secret. |
| `TAG_OWNER` | Optional. String to use for 'Owner' tag with which to tag all resources. If not specified, the created resources will not be tagged with an 'Owner' tag. |

Test build:

```
npm run cdk-synth
```

Deploy:

```
npm run cdk-deploy
```

Note: To deploy with a named profile, use:

```
npm run cdk-deploy -- --profile profilename
```

On completion, note the S3 bucket name into which the service will place the recording of the AudioHook audio and message events. It is output as `audiohook-fargate.recordingBucketName` exports. It can also be found in the `cdk-exports.json` file in the root of the project.

The path to the endpoint is `/api/v1/audiohook/ws`. That means for the above configuration, the endpoint URI would be `wss://audiohook.example.com/api/v1/audiohook/ws`. 


## Test Client

In the `client` directory is a simple command line client. It establishes a connection and synthesizes an audio stream of a 1 kHz tone (stereo or mono depending on which media format the server accepted). Messages are logged to stdout.

To run the client, replace the URI, API key and client secret with your own. Here, the sample API key and client secret from the protocol documentation are used.

```
cd client
npm start -- --uri wss://audiohook.example.com/api/v1/audiohook/ws --api-key SGVsbG8sIEkgYW0gdGhlIEFQSSBrZXkh --client-secret TXlTdXBlclNlY3JldEtleVRlbGxOby0xITJAMyM0JDU=
```

Pressing `CTRL-C` initiates a close transaction followed by disconnect and exit.

The client supports WAV files as audio source too. Mono or stereo WAV files are supported. They must be encoded in 16 bit linear PCM (format tag 1) or PCMU (format tag 7) at 8000Hz sample rate. 

```
npm start -- --uri wss://audiohook.example.com/api/v1/audiohook/ws --api-key SGVsbG8sIEkgYW0gdGhlIEFQSSBrZXkh --client-secret TXlTdXBlclNlY3JldEtleVRlbGxOby0xITJAMyM0JDU= --wavfile example.wav
```

Once the WAV file ends, the session closes and the client exits. A close can be initiated with `CTRL-C` at any time too.

## Recordings

The sample server implements a session recorder that creates a WAV file for the received audio and the sidecar JSON file that contains a log of all the received and sent protocol messages as well as log messages. When the conversation ends, the `.wav` and `.json` file are moved to the S3 bucket (see above). The path of the files files are stored in "folders" with the current date and the "filenames" of the objects are UUIDs. Note that UUID this is not the session ID of the AudioHook session. The AudioHook session ID can be found in the `.json` object or in the CloudWatch log.

## Run Locally

You can run the server locally one of two ways: Directly or as Docker container.

### Run Directly

```
cd app
npm run start
```

This creates a listener on localhost port 3000 and stores the recordings in the current working directory. It does not upload to S3. The recordings are not deleted if they cannot be moved to S3.

The following Environment variables can be set/passed to control the server:

| Name | Description |
| ---- | ---------- |
| `SERVERPORT` | Port on which server listens. Default: 3000 |
| `SERVERHOST` | Interface on which the server listens. Default: 127.0.0.1 |
| `LOG_ROOT_DIR` | Directory where to store the recordings. Default: current working directory. |
| `RECORDING_S3_BUCKET` | Name of S3 bucket to which the recordings are uploaded (and then deleted from `LOG_ROOT_DIR` if successful). In order for this upload to work, the appropriate AWS environment variables must be set (e.g. access keys or named profile reference). | 
| `SECRET_NAME_OR_ARN` | Optional ARN or name of the Amazon Secrets Manager secret to query for API key to secrets mappings. |
| `STATIC_API_KEY_MAP` | Optional string value that represent a JSON encoded object of name/value pairs, where the name is the API Key and the value the client secret. This is the same representation as stored in Amazon Secrets Manager, but allows hard-coding API keys/secrets without having to use the secrets manager. |

To run the client against the local server, see [Test Client](#test-client) section above, substituting the `wss://audiohook.example.com/api/v1/audiohook/ws` with `ws://localhost:3000/api/v1/audiohook/ws`.

### Run in Docker

By default, the container exposes port 8080.

```
cd app
docker build --tag audiohook-fargate:latest .
```

```
docker run --rm -it --init -p 127.0.0.1:3000:8080 -e 'STATIC_API_KEY_MAP={"SGVsbG8sIEkgYW0gdGhlIEFQSSBrZXkh":"TXlTdXBlclNlY3JldEtleVRlbGxOby0xITJAMyM0JDU="}' audiohook-fargate:latest
```

Run client same as shown above with the `ws://localhost:3000/api/v1/audiohook/ws` as URI, for example:

```
npm start -- --uri ws://localhost:3000/api/v1/audiohook/ws --api-key SGVsbG8sIEkgYW0gdGhlIEFQSSBrZXkh --client-secret TXlTdXBlclNlY3JldEtleVRlbGxOby0xITJAMyM0JDU=
```

## Agent Assist Entities - EXPERIMENTAL

> **IMPORTANT**
> 
> This is an experimental feature. It is not yet available through Genesys Cloud and will likely change significantly before release. 

The file `./app/audiohook/src/protocol/entities-agentassist.ts` contains type declarations for the experimental Agent Assist event messages. 
The `EventEntityDataAgentAssist` type represents the data for an assistance event. It can contain zero or more transcript utterances and zero or more suggestions. The Suggestions are a discriminant union of either FAQ entries (question/answer pairs) or article suggestions with excerpts and a document link. 

> **NOTE** 
> 
> A caller or agent utterance should be included only once. The client maintains history. Do not (re-)send all utterances in the `transcripts` property. Utterances can be sent in isolation (with no suggestion) or together. If the article queries may take some time, send the utterances early for a better user experience. 

The `./app/src/agentassist-hack.ts` file shows how to compose and send the event messages. It implements a quick-and-dirty sequencer that sends an utterance about 2 seconds after start of the session and then alternates every approximately 12 seconds dummy FAQ or article suggestions. 
