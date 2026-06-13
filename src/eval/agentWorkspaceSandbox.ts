import { spawnSync } from "node:child_process";
import { basename, relative, resolve } from "node:path";

export type AgentWorkspaceSandboxProbeOptions = {
  allowedReadRoot: string;
  allowedReadFile: string;
  deniedReadFile: string;
  allowedWriteRoot?: string;
  generatedAt?: string;
};

export type AgentWorkspaceSandboxProbe = {
  schema: 1;
  generatedAt?: string;
  verifier: "node_permission_process";
  nodeVersion: string;
  allowedReadRoot: string;
  allowedWriteRoot?: string;
  checks: {
    allowedRead: SandboxCommandResult;
    deniedRead: SandboxCommandResult;
  };
  pass: boolean;
  warnings: string[];
};

export type SandboxCommandResult = {
  path: string;
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  ok: boolean;
};

export function runAgentWorkspaceSandboxProbe(options: AgentWorkspaceSandboxProbeOptions): AgentWorkspaceSandboxProbe {
  const allowedReadRoot = resolve(options.allowedReadRoot);
  const allowedWriteRoot = options.allowedWriteRoot ? resolve(options.allowedWriteRoot) : undefined;
  const allowedRead = runSandboxRead({
    allowedReadRoot,
    allowedWriteRoot,
    filePath: resolve(options.allowedReadFile),
  });
  const deniedRead = runSandboxRead({
    allowedReadRoot,
    allowedWriteRoot,
    filePath: resolve(options.deniedReadFile),
  });
  const deniedByPermission = !deniedRead.ok && /permission|access|denied|ERR_ACCESS_DENIED/i.test(deniedRead.stderrPreview);

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    verifier: "node_permission_process",
    nodeVersion: process.version,
    allowedReadRoot: basename(allowedReadRoot),
    allowedWriteRoot: allowedWriteRoot ? basename(allowedWriteRoot) : undefined,
    checks: {
      allowedRead,
      deniedRead: {
        ...deniedRead,
        ok: deniedByPermission,
      },
    },
    pass: allowedRead.ok && deniedByPermission,
    warnings: [
      "node_permission_process proves local subprocess fs permissions for an agent workspace; it is not Docker, Harbor, network isolation, or a resource sandbox.",
    ],
  };
}

function runSandboxRead(args: {
  allowedReadRoot: string;
  allowedWriteRoot?: string;
  filePath: string;
}): SandboxCommandResult {
  const permissionArgs = [
    "--experimental-permission",
    `--allow-fs-read=${args.allowedReadRoot}`,
    ...(args.allowedWriteRoot ? [`--allow-fs-write=${args.allowedWriteRoot}`] : []),
  ];
  const script = [
    "const { readFileSync } = require('node:fs');",
    "const file = process.argv[1];",
    "process.stdout.write(readFileSync(file, 'utf8'));",
  ].join(" ");
  const result = spawnSync(process.execPath, [...permissionArgs, "-e", script, args.filePath], {
    cwd: args.allowedReadRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      Path: process.env.Path ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      WINDIR: process.env.WINDIR ?? "",
    },
    timeout: 10_000,
  });
  return {
    path: relative(process.cwd(), args.filePath).replace(/\\/g, "/"),
    exitCode: result.status,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
    ok: result.status === 0,
  };
}

function preview(value: string | Buffer | null | undefined): string {
  const raw = typeof value === "string" ? value : value?.toString("utf8") ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 400);
}
