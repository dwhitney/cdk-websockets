import * as core from "@aws-cdk/core"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2"
import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import { App, Stack, StackProps } from "@aws-cdk/core"

export class WebSocketStack extends Stack {
  
  constructor(app: App, id: string, props?: StackProps) {
    super(app, id, props)

    /**
     * A Lambda function that simply echos messages back to the client
     **/ 
    const websocketFunc = new lambda.Function(this, "WebSocketLambda", {
      description: "This Lambda will echo any message back to the client. Also it implicitly accepts any connection",
      code: lambda.Code.fromInline(`const AWS = require('aws-sdk');
exports.handler = function(event, context, callback){
  if(event.requestContext.eventType === "MESSAGE"){
    const endpoint = event.requestContext.domainName + '/' + event.requestContext.stage
    const apigw = new AWS.ApiGatewayManagementApi({ endpoint }); 
    apigw.postToConnection({
      ConnectionId: event.requestContext.connectionId,
      Data: event.body
    })
    .promise()
    .then(_ => callback(null, { statusCode: 200 }))
    .catch(callback)
  } else {
    callback(null, { statusCode: 200 });
  }
}`),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_12_X,
      memorySize: 128,
      timeout: core.Duration.seconds(30),
    })

    new lambda.Alias(this, "WebSocketLambdaAlias", {
      aliasName: "Prod",
      version: websocketFunc.currentVersion
    })

    const api = new apigatewayv2.CfnApi(this, "WebSocketProxyAPI", {
      name: "WebSocketAPI",
      description: "A Simple WebSockets API",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "\\$default",
    })

    const apiWildcardArn = core.Fn.join("",  [
        "arn:aws:execute-api:",
        core.Fn.ref("AWS::Region"),
        ":",
        core.Fn.ref("AWS::AccountId"),
        ":",
        api.ref,
        "/*"
      ])

    /**
     * This allows our API Gateway the permission to invoke our lambda"
    **/
    new lambda.CfnPermission(this, "InvokeAPIGatewayPermission", {
      action: "lambda:InvokeFunction",
      functionName: websocketFunc.functionName,
      principal: "apigateway.amazonaws.com",
      sourceArn: apiWildcardArn
    })

    /**
     * We need to allow our Lambda Function the ability to send messages to the API Gateway's @connections url, which is how messages are sent to connected clients
     **/
    websocketFunc.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [ "execute-api:ManageConnections" ],
      resources: [ apiWildcardArn ]
    }))

    /**
     *  Setup our Lambda Function as an AWS_PROXY integration
     **/
    const integration = new apigatewayv2.CfnIntegration(this, "WebSocketIntegration", {
      apiId: api.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${websocketFunc.functionArn}/invocations`
    })

    /**
     * The $connect route. This route is called when a client connects to the API. You can reject connections here, but in this example, we simply accept all connections 
     **/
    const connectRoute = new apigatewayv2.CfnRoute(this, "WebSocketConnectRoute", {
      routeKey: "$connect",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "ConnectRoute"
    })

    /**
     * This is the route called when regular messages are sent to the WebSocket. $connect is called first, and it must be successful before this route will ever be called
     **/
    const defaultRoute = new apigatewayv2.CfnRoute(this, "WebSocketDefaultRoute", {
      routeKey: "$default",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "DefaultRoute"
    })

    /**
     * This route is called when the client disconnects from the WebSocket. It's a good place to clean up any state.
     **/
    const disconnectRoute = new apigatewayv2.CfnRoute(this, "WebSocketDisconnectRoute", {
      routeKey: "$disconnect",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "DisconnectRoute"
    })

   
    /**
     * Boilerplate needed to deploy our stage
     **/ 
    const deployment = new apigatewayv2.CfnDeployment(this, "WebSocketDeployment", {
      apiId: api.ref
    })

    deployment.addDependsOn(defaultRoute)
    deployment.addDependsOn(connectRoute)
    deployment.addDependsOn(disconnectRoute)

    /**
     * The stage our WebSocket is deployed to. I tend to consider this boilerplate, but this is needed if you want to map a domain name to the WebSocket, or you want more options from a continuous deployment perspective
     **/ 
    const stage = new apigatewayv2.CfnStage(this, "WebSocketStage", {
      stageName: "live",
      apiId: api.ref,
      deploymentId: deployment.ref
    })

    /**
     * The endpoint to connect websocket clients to 
     **/
    new core.CfnOutput(this, "WebSocketEndpoint", {
      description: "The WebSocket endpoint. Connect to it with 'wscat -c <WebSocketEndpoint>'",
      value: core.Fn.join("/", [
        api.getAtt("ApiEndpoint").toString(),
        stage.stageName
        ]
        )
    })

  }

}