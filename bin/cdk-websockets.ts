#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkWebsocketsStack } from '../lib/cdk-websockets-stack';

const app = new cdk.App();
new CdkWebsocketsStack(app, 'CdkWebsocketsStack');
