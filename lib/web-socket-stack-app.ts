#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { WebSocketStack } from './web-socket-stack';

const app = new cdk.App();
new WebSocketStack(app, 'Websockets');
