# WebSockets in CDK

CDK doesn't currently have a simple way to create a WebSocket API with API Gateway V2, so I've painstakingly done it from the Cf* primitives, and I hope it's helpful to others.

## How to get this running

 * `npm install -g aws-cdk` Install cdk
 * `cdk deploy` deploy this stack to your default AWS account/region
 * `wscat -c <WebSocketEndpoint>` connect to the WebSocket with `wscat` and the `WebSocketEndpoint`, which is an output from the CloudFormation stack, and should be displayed on the commandline after a successful deployment
 * Type a message and it should be echoed back to you
