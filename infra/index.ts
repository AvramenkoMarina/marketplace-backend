import * as k8s from "@pulumi/kubernetes";

function requireVaultEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${name} is required: the value must be exported from the vault before Pulumi talks to the cluster`,
    );
  }
  return value;
}

const appDbPassword = requireVaultEnv("APP_DB_PASSWORD");

const image = process.env.APP_IMAGE ?? "marketplace-api:hw28";
const rev = process.env.APP_REV ?? "1";
const kubeContext = process.env.KUBE_CONTEXT ?? "kind-marketplace";

const replicas = 2;
const drainGraceSeconds = 30;

const provider = new k8s.Provider("kind", { context: kubeContext });

const namespace = new k8s.core.v1.Namespace(
  "marketplace",
  { metadata: { name: "marketplace" } },
  { provider },
);

const secret = new k8s.core.v1.Secret(
  "marketplace-db",
  {
    metadata: {
      name: "marketplace-db",
      namespace: namespace.metadata.name,
    },
    type: "Opaque",
    data: {
      APP_DB_PASSWORD: Buffer.from(appDbPassword, "utf8").toString("base64"),
    },
  },
  { provider },
);

const labels = { app: "marketplace" };

const appProbe: k8s.types.input.core.v1.Probe = {
  httpGet: { path: "/healthz", port: 3000 },
  periodSeconds: 1,
  timeoutSeconds: 1,
  failureThreshold: 30,
};

const appReadiness: k8s.types.input.core.v1.Probe = {
  httpGet: { path: "/readyz", port: 3000 },
  periodSeconds: 1,
  timeoutSeconds: 1,
  failureThreshold: 1,
  successThreshold: 1,
};

const appLiveness: k8s.types.input.core.v1.Probe = {
  httpGet: { path: "/healthz", port: 3000 },
  periodSeconds: 10,
  timeoutSeconds: 1,
  failureThreshold: 3,
};

const sidecarReadiness: k8s.types.input.core.v1.Probe = {
  httpGet: { path: "/readyz", port: 3001 },
  periodSeconds: 1,
  timeoutSeconds: 1,
  failureThreshold: 2,
  successThreshold: 1,
};

const sidecarLiveness: k8s.types.input.core.v1.Probe = {
  httpGet: { path: "/healthz", port: 3001 },
  periodSeconds: 10,
  timeoutSeconds: 1,
  failureThreshold: 3,
};

const podSecurity: k8s.types.input.core.v1.PodSecurityContext = {
  runAsNonRoot: true,
  runAsUser: 65532,
  runAsGroup: 65532,
  fsGroup: 65532,
  seccompProfile: { type: "RuntimeDefault" },
};

const containerSecurity: k8s.types.input.core.v1.SecurityContext = {
  runAsNonRoot: true,
  runAsUser: 65532,
  runAsGroup: 65532,
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ["ALL"] },
};

const secretEnv: k8s.types.input.core.v1.EnvVar = {
  name: "APP_DB_PASSWORD",
  valueFrom: {
    secretKeyRef: {
      name: secret.metadata.name,
      key: "APP_DB_PASSWORD",
    },
  },
};

const deployment = new k8s.apps.v1.Deployment(
  "marketplace",
  {
    metadata: {
      name: "marketplace",
      namespace: namespace.metadata.name,
      labels,
    },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      minReadySeconds: 2,
      progressDeadlineSeconds: 180,
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: {
          maxUnavailable: 0,
          maxSurge: 1,
        },
      },
      template: {
        metadata: {
          labels,
          annotations: { "marketplace/rev": rev },
        },
        spec: {
          terminationGracePeriodSeconds: drainGraceSeconds,
          securityContext: podSecurity,
          automountServiceAccountToken: false,
          volumes: [{ name: "tmp", emptyDir: {} }],
          containers: [
            {
              name: "api",
              image,
              imagePullPolicy: "IfNotPresent",
              command: ["/nodejs/bin/node", "server.mjs"],
              ports: [{ name: "http", containerPort: 3000 }],
              env: [
                secretEnv,
                { name: "PORT", value: "3000" },
                { name: "CONTAINER_ROLE", value: "app" },
                { name: "WARMUP_MS", value: "4000" },
                { name: "DRAIN_MS", value: "10000" },
                { name: "REV", value: rev },
              ],
              startupProbe: appProbe,
              readinessProbe: appReadiness,
              livenessProbe: appLiveness,
              securityContext: containerSecurity,
              resources: {
                requests: { cpu: "20m", memory: "32Mi" },
                limits: { cpu: "200m", memory: "128Mi" },
              },
              volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
            },
            {
              name: "log-sidecar",
              image,
              imagePullPolicy: "IfNotPresent",
              command: ["/nodejs/bin/node", "server.mjs"],
              ports: [{ name: "sidecar", containerPort: 3001 }],
              env: [
                secretEnv,
                { name: "PORT", value: "3001" },
                { name: "CONTAINER_ROLE", value: "sidecar" },
                { name: "DRAIN_MS", value: "10000" },
                { name: "REV", value: rev },
              ],
              readinessProbe: sidecarReadiness,
              livenessProbe: sidecarLiveness,
              securityContext: containerSecurity,
              resources: {
                requests: { cpu: "10m", memory: "16Mi" },
                limits: { cpu: "100m", memory: "64Mi" },
              },
              volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
            },
          ],
        },
      },
    },
  },
  { provider, customTimeouts: { create: "5m", update: "5m" } },
);

new k8s.core.v1.Service(
  "marketplace",
  {
    metadata: {
      name: "marketplace",
      namespace: namespace.metadata.name,
      labels,
    },
    spec: {
      type: "NodePort",
      selector: labels,
      ports: [
        {
          name: "http",
          port: 3000,
          targetPort: 3000,
          nodePort: 30080,
        },
      ],
    },
  },
  { provider },
);

new k8s.policy.v1.PodDisruptionBudget(
  "marketplace",
  {
    metadata: {
      name: "marketplace",
      namespace: namespace.metadata.name,
      labels,
    },
    spec: {
      minAvailable: 1,
      selector: { matchLabels: labels },
    },
  },
  { provider },
);

new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  "marketplace",
  {
    metadata: {
      name: "marketplace",
      namespace: namespace.metadata.name,
      labels,
    },
    spec: {
      scaleTargetRef: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name: deployment.metadata.name,
      },
      minReplicas: 2,
      maxReplicas: 4,
      metrics: [
        {
          type: "Resource",
          resource: {
            name: "cpu",
            target: {
              type: "Utilization",
              averageUtilization: 70,
            },
          },
        },
      ],
    },
  },
  { provider },
);

export const namespaceName = namespace.metadata.name;
export const deploymentName = deployment.metadata.name;
export const imageName = image;
