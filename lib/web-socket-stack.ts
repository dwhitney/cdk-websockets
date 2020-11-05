import * as core from "@aws-cdk/core"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2"
import * as dynamodb from "@aws-cdk/aws-dynamodb"
import * as lambda from "@aws-cdk/aws-lambda"
import * as sources from "@aws-cdk/aws-lambda-event-sources"
import * as sqs from "@aws-cdk/aws-sqs"
import { App, Stack, StackProps } from "@aws-cdk/core"

export class WebSocketStack extends Stack {
  public readonly lambdaCode: lambda.CfnParametersCode
  constructor(app: App, id: string, props?: StackProps) {
    super(app, id, props)

    const websocketFunc = new lambda.Function(this, "WebSocketLambda", {
      code: lambda.Code.fromInline("exports.handler = function(event, context, callback){ callback(null, { statusCode: 200 }) }"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_12_X,
      memorySize: 128,
      timeout: core.Duration.seconds(30),
      environment: {
        IDENTITY_POOL_ID: "",
        USER_POOL_ID: "",
        CLIENT_ID: ""
      }
    })
    const alias = new lambda.Alias(this, "WebSocketLambdaAlias", {
      aliasName: "Prod",
      version: websocketFunc.currentVersion
    })

    const api = new apigatewayv2.CfnApi(this, "WebSocketProxyAPI", {
      name: "WebSocketAPI",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "\\$default",
    })
    new lambda.CfnPermission(this, "InvokeAPIGatewayPermission", {
      action: "lambda:InvokeFunction",
      functionName: websocketFunc.functionName,
      principal: "apigateway.amazonaws.com",
      sourceArn: core.Fn.join("",  [
        "arn:aws:execute-api:",
        core.Fn.ref("AWS::Region"),
        ":",
        core.Fn.ref("AWS::AccountId"),
        ":",
        api.ref,
        "/*"
      ])
    })

    const authorizer = new apigatewayv2.CfnAuthorizer(this, "WebSocketCognitoAuthorizer", {
      authorizerType: "REQUEST",
      identitySource: ["route.request.querystring.token"],
      apiId: api.ref,
      name: "WebSocketCognitoAuthorizerV2",
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${websocketFunc.functionArn}/invocations`
    })

    const integration = new apigatewayv2.CfnIntegration(this, "WebSocketIntegration", {
      apiId: api.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${websocketFunc.functionArn}/invocations`
    })

    const connectRoute = new apigatewayv2.CfnRoute(this, "WebSocketConnectRoute", {
      routeKey: "$connect",
      apiId: api.ref,
      target: core.Fn.join("/", [ "integrations", integration.ref ]),
      authorizationType: "REQUEST",
      authorizerId: authorizer.ref,
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

    new apigatewayv2.CfnStage(this, "WebSocketStage", {
      stageName: "v1",
      apiId: api.ref,
      deploymentId: deployment.ref
    })

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      tableName: "subscriptions",
      partitionKey: { name: "ConnectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    })

    connectionsTable.grantReadWriteData(websocketFunc)

    const deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue")

    websocketFunc.addEventSource(new sources.DynamoEventSource(connectionsTable, {
      batchSize: 1, 
      onFailure: new sources.SqsDlq(deadLetterQueue),
      retryAttempts: 5,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
    }))

    websocketFunc.addEventSource(new sources.DynamoEventSource(connectionsTable, {
      batchSize: 1, 
      onFailure: new sources.SqsDlq(deadLetterQueue),
      retryAttempts: 5,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
    }))
  }
}