# d2domains Production Deploy

This CDK app is the AWS production deployment baseline for the repo.

It creates:
- a VPC and ECS cluster
- ECR repositories for the client and all backend services
- a CodePipeline scaffold for source, synth, and service rollout stages

Before deploying, set:
- `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION`
- the GitHub source settings in `deploy/lib/production-pipeline-stack.ts`

Run:

```bash
cd deploy
npm install
npm run synth
```

The stack is intentionally conservative so we can extend it without breaking the existing local Docker workflow.
