import {
  Duration,
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_ecr_assets as ecrAssets,
  aws_secretsmanager as secretsmanager,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const appServices = [
  { name: "hog", port: 8787, public: true },
  { name: "heron", port: 8783, public: false },
  { name: "weasel", port: 8781, public: false },
  { name: "wombat", port: 8782, public: false },
  { name: "badger", port: 0, public: false },
  { name: "beaver", port: 0, public: false },
  { name: "mockingbird", port: 8890, public: false },
  { name: "otter", port: 8784, public: false },
  { name: "pigeon", port: 8785, public: false },
];

export class WorkloadStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const prodSecrets = secretsmanager.Secret.fromSecretNameV2(this, "ProdSecrets", "d2domains-production-secrets");

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
    });

    cluster.addDefaultCloudMapNamespace({
      name: "d2domains.local",
    });

    const sharedEnv = {
      APP_ENV: "production",
      CLIENT_ORIGIN: "http://d2domains.local",
      REDIS_URL: "redis://redis.d2domains.local:6379",
      INTERNAL_TOKEN: "d2d-internal-token-prod",
      NAME_COM_BASE: "https://api.dev.name.com",
    } as const;

    const clientImage = new ecrAssets.DockerImageAsset(this, "ClientImage", {
      directory: "../client",
      file: "Dockerfile",
      platform: ecrAssets.Platform.LINUX_AMD64,
      buildArgs: {
        HOG_URL: "http://hog.d2domains.local:8787",
      },
    });

    new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ClientService", {
      cluster,
      desiredCount: 2,
      publicLoadBalancer: true,
      cpu: 512,
      memoryLimitMiB: 1024,
      assignPublicIp: false,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      listenerPort: 80,
      healthCheckGracePeriod: Duration.minutes(2),
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(clientImage),
        containerPort: 3000,
        environment: {
          HOG_URL: "http://hog.d2domains.local:8787",
        },
      },
    });

    // Postgres Service
    const postgresImage = new ecrAssets.DockerImageAsset(this, "PostgresImage", {
      directory: "../",
      exclude: ["deploy/cdk.out", "deploy/node_modules", ".git", "node_modules"],
      file: "deploy/Dockerfile.postgres",
      platform: ecrAssets.Platform.LINUX_AMD64,
    });
    
    const postgresTask = new ecs.FargateTaskDefinition(this, "PostgresTask", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    const postgresContainer = postgresTask.addContainer("PostgresContainer", {
      image: ecs.ContainerImage.fromDockerImageAsset(postgresImage),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "postgres" }),
      environment: {
        POSTGRES_DB: "d2gres",
        POSTGRES_PASSWORD: "postgres",
      },
    });
    postgresContainer.addPortMappings({ containerPort: 5432 });
    
    const postgresService = new ecs.FargateService(this, "PostgresService", {
      cluster,
      taskDefinition: postgresTask,
      desiredCount: 1,
      assignPublicIp: false,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: "postgres",
      },
    });
    postgresService.connections.allowFromAnyIpv4(ec2.Port.tcp(5432));

    // Redis Service
    const redisTask = new ecs.FargateTaskDefinition(this, "RedisTask", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    const redisContainer = redisTask.addContainer("RedisContainer", {
      image: ecs.ContainerImage.fromRegistry("redis:alpine"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "redis" }),
    });
    redisContainer.addPortMappings({ containerPort: 6379 });

    const redisService = new ecs.FargateService(this, "RedisService", {
      cluster,
      taskDefinition: redisTask,
      desiredCount: 1,
      assignPublicIp: false,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: "redis",
      },
    });
    redisService.connections.allowFromAnyIpv4(ec2.Port.tcp(6379));

    for (const service of appServices) {
      const image = new ecrAssets.DockerImageAsset(this, `${service.name}Image`, {
        directory: `../system/${service.name}`,
        file: "Dockerfile",
        platform: ecrAssets.Platform.LINUX_AMD64,
      });

      const taskDefinition = new ecs.FargateTaskDefinition(this, `${service.name}Task`, {
        cpu: 256,
        memoryLimitMiB: 512,
      });

      const envAndSecrets = this.serviceEnvironment(service.name, prodSecrets);

      const container = taskDefinition.addContainer(`${service.name}Container`, {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: service.name }),
        environment: {
          ...sharedEnv,
          ...envAndSecrets.environment,
        },
        secrets: envAndSecrets.secrets,
      });

      if (service.port > 0) {
        container.addPortMappings({ containerPort: service.port });
      }

      const ecsService = new ecs.FargateService(this, `${service.name}Service`, {
        cluster,
        taskDefinition,
        desiredCount: service.name === "badger" || service.name === "beaver" || service.name === "pigeon" ? 1 : 2,
        assignPublicIp: false,
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        cloudMapOptions: {
          name: service.name,
        },
      });

      if (service.port > 0) {
        ecsService.connections.allowFromAnyIpv4(ec2.Port.tcp(service.port));
      }
    }
  }

  private serviceEnvironment(name: string, prodSecrets: secretsmanager.ISecret): { environment: Record<string, string>, secrets?: Record<string, ecs.Secret> } {
    switch (name) {
      case "hog":
        return {
          environment: {
            DATABASE_URL: "postgres://postgres:postgres@postgres.d2domains.local:5432/d2gres",
            REGISTRY_URL: "http://heron.d2domains.local:8783",
            WEASEL_URL: "http://weasel.d2domains.local:8781",
            WOMBAT_URL: "http://wombat.d2domains.local:8782",
            OTTER_URL: "http://otter.d2domains.local:8784",
            DOVE_URL: "http://dove.d2domains.local:8786",
            REDIS_URL: "redis://redis.d2domains.local:6379",
          }
        };
      case "heron":
        return {
          environment: {
            NAME_COM_BASE: "https://api.dev.name.com",
          },
          secrets: {
            NAME_COM_USERNAME: ecs.Secret.fromSecretsManager(prodSecrets, "NAME_COM_USERNAME"),
            NAME_COM_TOKEN: ecs.Secret.fromSecretsManager(prodSecrets, "NAME_COM_TOKEN"),
          }
        };
      case "weasel":
        return {
          environment: {
            WEASEL_DATABASE_URL: "postgres://postgres:postgres@postgres.d2domains.local:5432/d2weasel",
          }
        };
      case "wombat":
        return {
          environment: {
            WOMBAT_DATABASE_URL: "postgres://postgres:postgres@postgres.d2domains.local:5432/d2wombat",
          },
          secrets: {
            STRIPE_SECRET_KEY: ecs.Secret.fromSecretsManager(prodSecrets, "STRIPE_SECRET_KEY"),
            STRIPE_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(prodSecrets, "STRIPE_PUBLISHABLE_KEY"),
            STRIPE_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(prodSecrets, "STRIPE_WEBHOOK_SECRET"),
          }
        };
      case "otter":
        return {
          environment: {
            OTTER_DATABASE_URL: "postgres://postgres:postgres@postgres.d2domains.local:5432/d2otter",
            REGISTRY_URL: "http://heron.d2domains.local:8783",
          }
        };
      case "pigeon":
        return {
          environment: {
            PIGEON_DATABASE_URL: "postgres://postgres:postgres@postgres.d2domains.local:5432/d2pigeon",
            WEASEL_URL: "http://weasel.d2domains.local:8781",
            OTTER_URL: "http://otter.d2domains.local:8784",
          }
        };
      case "mockingbird":
        return { environment: {} };
      case "badger":
      case "beaver":
        return { environment: {} };
      default:
        return { environment: {} };
    }
  }
}
