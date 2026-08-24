import {
  Stack,
  StackProps,
  aws_codebuild as codebuild,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as cpactions,
  aws_iam as iam,
  SecretValue,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class ProductionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact();
    const synthOutput = new codepipeline.Artifact("SynthOutput");

    const sourceAction = new cpactions.GitHubSourceAction({
      actionName: "GitHub",
      owner: "Jaggler3",
      repo: "d2domains",
      branch: "main",
      oauthToken: SecretValue.secretsManager("github-token"),
      output: sourceOutput,
      trigger: cpactions.GitHubTrigger.WEBHOOK,
    });

    const synthProject = new codebuild.PipelineProject(this, "SynthProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
              "cd deploy",
              "npm ci",
            ],
          },
          build: {
            commands: [
              "npm run synth",
            ],
          },
        },
        artifacts: {
          "base-directory": "deploy/cdk.out",
          files: ["**/*"],
        },
      }),
    });

    const deployProject = new codebuild.PipelineProject(this, "DeployProject", {
      role: new iam.Role(this, "DeployRole", {
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
        ],
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              "cd deploy",
              "npm ci",
              "npx cdk deploy D2DomainsWorkloadStack --require-approval never --app cdk.out",
            ],
          },
        },
      }),
    });

    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "d2domains-production",
      restartExecutionOnUpdate: true,
    });

    pipeline.addStage({
      stageName: "Source",
      actions: [sourceAction],
    });

    pipeline.addStage({
      stageName: "Synth",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Synth",
          project: synthProject,
          input: sourceOutput,
          outputs: [synthOutput],
        }),
      ],
    });

    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "DeployWorkload",
          project: deployProject,
          input: synthOutput,
        }),
      ],
    });
  }
}
