/**
 * Chat-first capture — deterministic rung (persona: founder typing "just spoke with X" between
 * meetings). The grader is only trustworthy if it can FAIL, so this suite runs both the
 * protocol-following plan AND a naive saboteur that does every intuitive-but-wrong thing at once:
 * interrogates before writing, demands an upload, duplicates a known row, guesses the ambiguous
 * entity, and fabricates a source citation for a chat claim.
 */
import { describe, expect, it } from "vitest";
import {
  chatIntakeCapturePlan,
  junkCapturePlan,
  naiveChatIntakePlan,
  runChatIntakeCapture,
} from "../evals/chatIntakeRuntime";
import { scriptedModel } from "../src/agent/scripted";

describe("CHAT-INTAKE RUNG — capture-first contract through the real room runtime", () => {
  it("captures three companies from one chat note: new row, CAS update, ambiguous-as-needs_review — all before the single clarifying question", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(chatIntakeCapturePlan(), "scripted-chat-intake"),
      modelName: "scripted",
    });
    expect(report.status, JSON.stringify(report.checks)).toBe("passed");
    expect(report.checks.capturedBeforeClarify).toBe(true);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(true);
    expect(report.checks.newLeadCaptured).toBe(true);
    expect(report.checks.chatClaimsStayManual).toBe(true);
    expect(report.checks.duplicatePrevented).toBe(true);
    expect(report.checks.ambiguousNotGuessed).toBe(true);
    expect(report.checks.privateChannelOnly).toBe(true);
  });

  it("FAILS the naive interrogator — every wrong behavior trips its own named check", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(naiveChatIntakePlan(), "naive-chat-intake"),
      modelName: "naive",
    });
    expect(report.status).toBe("failed");
    // Two questions before any write:
    expect(report.checks.capturedBeforeClarify).toBe(false);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(false);
    // "Can you upload their pitch deck file":
    expect(report.checks.noUploadDemanded).toBe(false);
    // Meridian never captured:
    expect(report.checks.newLeadCaptured).toBe(false);
    // Fabricated "source" citation on a chat claim:
    expect(report.checks.chatClaimsStayManual).toBe(false);
    // Second Northwind row created:
    expect(report.checks.duplicatePrevented).toBe(false);
    // Confidently linked "Caldera Therapeutics" without evidence:
    expect(report.checks.ambiguousNotGuessed).toBe(false);
    // Failure isolation: the saboteur still followed lock/release protocol and stayed private —
    // those checks must NOT be dragged down by the behavioral failures.
    expect(report.checks.lockedBeforeWrite).toBe(true);
    expect(report.checks.releasedLock).toBe(true);
    expect(report.checks.privateChannelOnly).toBe(true);
  });

  it("FAILS the silent junk run — the checks the interrogator leaves untouched can also fail", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(junkCapturePlan(), "junk-capture"),
      modelName: "junk",
    });
    expect(report.status).toBe("failed");
    // release_lock("lk_bogus") was REJECTED by the engine — a failed call earns no credit:
    expect(report.checks.releasedLock).toBe(false);
    // Company name alone is not a captured lead (no contact, no what, no funding, no needs_review):
    expect(report.checks.newLeadCaptured).toBe(false);
    // A changed content cell with zero evidence fails the per-cell manual-evidence rule:
    expect(report.checks.chatClaimsStayManual).toBe(false);
    // Northwind never updated; Caldera never captured; no private ack ever sent:
    expect(report.checks.duplicatePrevented).toBe(false);
    expect(report.checks.ambiguousNotGuessed).toBe(false);
    expect(report.checks.privateChannelOnly).toBe(false);
    // And the question-budget checks stay true — silence is not an interrogation:
    expect(report.checks.capturedBeforeClarify).toBe(true);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(true);
  });
});
