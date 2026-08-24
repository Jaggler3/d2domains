import { App } from "aws-cdk-lib";
import { WorkloadStack } from "../lib/workload-stack.js";
import { ProductionPipelineStack } from "../lib/production-pipeline-stack.js";

const app = new App();

new WorkloadStack(app, "D2DomainsWorkloadStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new ProductionPipelineStack(app, "D2DomainsProductionPipeline", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
