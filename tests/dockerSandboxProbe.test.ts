import { describe, expect, it } from "vitest";
import { runDockerSandboxProbe } from "../src/eval/dockerSandboxProbe";

describe("Docker sandbox probe", () => {
  it("records Docker/Harbor availability without promoting unavailable environments", () => {
    const report = runDockerSandboxProbe({
      image: "node:22-alpine",
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      schema: 1,
      verifier: "docker_harbor_availability_probe",
      image: "node:22-alpine",
    });
    expect(["container_isolation_proven", "cli_missing", "daemon_unavailable", "image_unavailable", "container_failed"]).toContain(report.status);
    expect(report.pass).toBe(report.status === "container_isolation_proven");
    expect(report.dockerCli.command).toBe("docker --version");
    expect(report.daemon.command).toBe("docker info --format {{json .ServerVersion}}");
    if (!report.pass) {
      expect(report.warnings.join(" ")).toContain("official benchmark readiness must remain red");
    }
    if (report.container) {
      expect(report.container).toMatchObject({
        networkMode: "none",
        mountedAgentWorkspace: true,
        mountedEvaluatorWorkspace: false,
      });
    }
  });
});
