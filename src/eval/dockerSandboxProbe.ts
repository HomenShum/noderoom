import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DockerSandboxProbeStatus =
  | "container_isolation_proven"
  | "cli_missing"
  | "daemon_unavailable"
  | "image_unavailable"
  | "container_failed";

export type DockerCommandResult = {
  command: string;
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  ok: boolean;
};

export type DockerSandboxProbe = {
  schema: 1;
  generatedAt?: string;
  verifier: "docker_harbor_availability_probe";
  status: DockerSandboxProbeStatus;
  pass: boolean;
  image: string;
  dockerCli: DockerCommandResult;
  daemon: DockerCommandResult;
  container?: DockerCommandResult & {
    networkMode: "none";
    mountedAgentWorkspace: true;
    mountedEvaluatorWorkspace: false;
  };
  warnings: string[];
};

export type DockerSandboxProbeOptions = {
  image?: string;
  fixtureRoot?: string;
  generatedAt?: string;
};

const defaultImage = "node:22-alpine";

export function runDockerSandboxProbe(options: DockerSandboxProbeOptions = {}): DockerSandboxProbe {
  const image = options.image ?? defaultImage;
  const dockerCli = run("docker", ["--version"]);
  if (!dockerCli.ok) return report({ generatedAt: options.generatedAt, image, status: "cli_missing", dockerCli });

  const daemon = run("docker", ["info", "--format", "{{json .ServerVersion}}"]);
  if (!daemon.ok) return report({ generatedAt: options.generatedAt, image, status: "daemon_unavailable", dockerCli, daemon });

  const fixtureRoot = resolve(options.fixtureRoot ?? join(".tmp", "docker-sandbox-probe"));
  const agentRoot = join(fixtureRoot, "agent-workspace");
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(agentRoot, { recursive: true });
    writeFileSync(join(agentRoot, "task.json"), `${JSON.stringify({ taskId: "docker-sandbox-probe", visible: true }, null, 2)}\n`);
    const script = [
      "const fs=require('node:fs');",
      "const agent=fs.readFileSync('/agent/task.json','utf8');",
      "let denied=false;",
      "try{fs.readFileSync('/evaluator/gold.json','utf8')}catch{denied=true}",
      "process.stdout.write(JSON.stringify({agentVisible:agent.includes('docker-sandbox-probe'),evaluatorDenied:denied}));",
      "if(!agent.includes('docker-sandbox-probe')||!denied)process.exit(7);",
    ].join("");
    const container = run("docker", [
      "run",
      "--rm",
      "--pull=never",
      "--network=none",
      "--read-only",
      "-v",
      `${agentRoot}:/agent:ro`,
      image,
      "node",
      "-e",
      script,
    ]);
    if (!container.ok && /pull access denied|not found|No such image|image.*known|Unable to find image/i.test(`${container.stderrPreview} ${container.stdoutPreview}`)) {
      return report({ generatedAt: options.generatedAt, image, status: "image_unavailable", dockerCli, daemon, container });
    }
    return report({
      generatedAt: options.generatedAt,
      image,
      status: container.ok ? "container_isolation_proven" : "container_failed",
      dockerCli,
      daemon,
      container,
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function report(args: {
  generatedAt?: string;
  image: string;
  status: DockerSandboxProbeStatus;
  dockerCli: DockerCommandResult;
  daemon?: DockerCommandResult;
  container?: DockerCommandResult;
}): DockerSandboxProbe {
  const daemon = args.daemon ?? {
    command: "docker info --format {{json .ServerVersion}}",
    exitCode: null,
    stdoutPreview: "",
    stderrPreview: "not run",
    ok: false,
  };
  const pass = args.status === "container_isolation_proven";
  const warnings = [
    ...(pass ? [] : ["Docker/Harbor process isolation is not proven in this environment; official benchmark readiness must remain red."]),
    ...(args.status === "daemon_unavailable" ? ["Docker CLI is installed, but the Docker daemon is unavailable or Docker Desktop is not running."] : []),
    ...(args.status === "image_unavailable" ? [`Docker daemon is reachable, but image ${args.image} is not available locally with --pull=never.`] : []),
    ...(args.status === "container_failed" ? ["Docker container probe ran but did not prove agent-only workspace isolation."] : []),
  ];
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    verifier: "docker_harbor_availability_probe",
    status: args.status,
    pass,
    image: args.image,
    dockerCli: args.dockerCli,
    daemon,
    ...(args.container
      ? {
          container: {
            ...args.container,
            networkMode: "none" as const,
            mountedAgentWorkspace: true as const,
            mountedEvaluatorWorkspace: false as const,
          },
        }
      : {}),
    warnings,
  };
}

function run(command: string, args: string[]): DockerCommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    shell: false,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr || result.error?.message),
    ok: result.status === 0,
  };
}

function preview(value: string | Buffer | Error | null | undefined): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : value?.toString("utf8") ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}
