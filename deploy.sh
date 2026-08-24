#!/bin/zsh

# Update the pipeline definition first
echo "Updating pipeline definition..."
cd deploy && npm run deploy:pipeline || npx cdk deploy D2DomainsProductionPipeline

# Trigger the pipeline execution
echo "Starting pipeline execution..."
PIPELINE_NAME=$(aws codepipeline list-pipelines --query 'pipelines[0].name' --output text)
aws codepipeline start-pipeline-execution --name "$PIPELINE_NAME"

echo "Deployment triggered successfully!"
