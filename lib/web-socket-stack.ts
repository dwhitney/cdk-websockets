import * as core from "@aws-cdk/core"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2"
import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import { App, Stack, StackProps } from "@aws-cdk/core"

export class WebSocketStack extends Stack {
  
  constructor(app: App, id: string, props?: StackProps) {
    super(app, id, props)

    const websocketFunc = new lambda.Function(this, "WebSocketLambda", {
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

    new lambda.CfnPermission(this, "InvokeAPIGatewayPermission", {
      action: "lambda:InvokeFunction",
      functionName: websocketFunc.functionName,
      principal: "apigateway.amazonaws.com",
      sourceArn: apiWildcardArn
    })

    websocketFunc.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [ "execute-api:ManageConnections" ],
      resources: [ apiWildcardArn ]
    }))

    const integration = new apigatewayv2.CfnIntegration(this, "WebSocketIntegration", {
      apiId: api.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${websocketFunc.functionArn}/invocations`
    })

    const connectRoute = new apigatewayv2.CfnRoute(this, "WebSocketConnectRoute", {
      routeKey: "$connect",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "ConnectRoute"
    })

    const defaultRoute = new apigatewayv2.CfnRoute(this, "WebSocketDefaultRoute", {
      routeKey: "$default",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "DefaultRoute"
    })

    const disconnectRoute = new apigatewayv2.CfnRoute(this, "WebSocketDisconnectRoute", {
      routeKey: "$disconnect",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "DisconnectRoute"
    })

    
    const deployment = new apigatewayv2.CfnDeployment(this, "WebSocketDeployment", {
      apiId: api.ref
    })

    deployment.addDependsOn(defaultRoute)
    deployment.addDependsOn(connectRoute)
    deployment.addDependsOn(disconnectRoute)

    const stage = new apigatewayv2.CfnStage(this, "WebSocketStage", {
      stageName: "live",
      apiId: api.ref,
      deploymentId: deployment.ref
    })

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