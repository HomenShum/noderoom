import type { CellEvidence, CellPayload } from "../engine/types";
import type { CellView, RoomTools } from "./types";

export type AlgorithmArtifactKind = "spreadsheet_formula";
export type AlgorithmArtifactLanguage = "formula_dsl" | "noderoom_dsl";
export type AlgorithmOutputFormat = "number" | "currency" | "percent";

export interface AlgorithmArtifactInput {
  id: string;
  elementId: string;
  label?: string;
}

export interface AlgorithmArtifactOutput {
  id: string;
  elementId: string;
  expression: string;
  format?: AlgorithmOutputFormat;
  label?: string;
}

export interface AlgorithmArtifactTest {
  name: string;
  inputs: Record<string, number>;
  expected: Record<string, number>;
  tolerance?: number;
}

export interface AlgorithmArtifactConstraints {
  deterministic?: boolean;
  noNetwork?: boolean;
  noRandom?: boolean;
  noDateNow?: boolean;
  maxInputs?: number;
  maxOutputs?: number;
}

export interface AlgorithmArtifact {
  schema: 1;
  algorithmId: string;
  name: string;
  description?: string;
  kind: AlgorithmArtifactKind;
  language: AlgorithmArtifactLanguage;
  inputs: AlgorithmArtifactInput[];
  outputs: AlgorithmArtifactOutput[];
  constraints?: AlgorithmArtifactConstraints;
  evidencePolicy?: {
    requireSourceCells?: boolean;
  };
  tests?: AlgorithmArtifactTest[];
}

export interface AlgorithmCellSnapshot {
  id: string;
  value: unknown;
  version: number;
}

export interface AlgorithmPatch {
  elementId: string;
  baseVersion: number;
  kind: "set";
  value: CellPayload;
}

export interface AlgorithmPatchBundle {
  schema: 1;
  algorithmId: string;
  artifactHash: string;
  status: "passed";
  commitPolicy: "patch_bundle_only_runtime_must_cas";
  patches: AlgorithmPatch[];
  writeLockedCellResultsArgs: {
    reason: string;
    ops: Array<{
      elementId: string;
      baseVersion: number;
      value: unknown;
      status: NonNullable<CellPayload["status"]>;
      confidence: number;
      normalizedValue: unknown;
      formula: string;
      evidence: NonNullable<CellPayload["evidence"]>;
      kind: "set";
    }>;
  };
  proof: {
    runnerVersion: string;
    deterministic: true;
    testsPassed: number;
    inputRefs: Array<{
      id: string;
      elementId: string;
      version: number;
      valueHash: string;
    }>;
    outputRefs: Array<{
      id: string;
      elementId: string;
      baseVersion: number;
      expression: string;
      normalizedValue: number;
    }>;
  };
}

export type AlgorithmArtifactResult =
  | { ok: true; bundle: AlgorithmPatchBundle }
  | { ok: false; errors: string[]; artifactHash?: string };

export const ALGORITHM_ARTIFACT_RUNNER_VERSION = "algorithm-artifact-runner:v1";

export function runAlgorithmArtifact(
  artifact: AlgorithmArtifact,
  snapshot: Record<string, AlgorithmCellSnapshot>,
): AlgorithmArtifactResult {
  const validation = validateAlgorithmArtifact(artifact);
  if (!validation.ok) return validation;

  const artifactHash = hashStable(artifact);
  const inputValues = new Map<string, number>();
  const inputRefs: AlgorithmPatchBundle["proof"]["inputRefs"] = [];
  const errors: string[] = [];

  for (const input of artifact.inputs) {
    const cell = snapshot[input.elementId];
    if (!cell) {
      errors.push(`missing input snapshot for ${input.id} (${input.elementId})`);
      continue;
    }
    const parsed = parseCellNumber(cell.value);
    if (parsed === null) {
      errors.push(`input ${input.id} (${input.elementId}) is not numeric`);
      continue;
    }
    inputValues.set(input.id, parsed);
    inputRefs.push({
      id: input.id,
      elementId: input.elementId,
      version: cell.version,
      valueHash: hashStable({ value: cell.value, version: cell.version }),
    });
  }
  if (errors.length) return { ok: false, errors, artifactHash };

  const testErrors = runArtifactTests(artifact);
  if (testErrors.length) return { ok: false, errors: testErrors, artifactHash };

  const patches: AlgorithmPatch[] = [];
  const outputRefs: AlgorithmPatchBundle["proof"]["outputRefs"] = [];
  for (const output of artifact.outputs) {
    const computed = evaluateExpression(output.expression, inputValues);
    if (!Number.isFinite(computed)) {
      return { ok: false, errors: [`output ${output.id} produced a non-finite value`], artifactHash };
    }
    const target = snapshot[output.elementId];
    const baseVersion = target?.version ?? 0;
    const value = formatOutputValue(computed, output.format ?? "number");
    const evidence = buildEvidence(artifact, output, inputRefs);
    patches.push({
      elementId: output.elementId,
      baseVersion,
      kind: "set",
      value: {
        value,
        status: "complete",
        confidence: 1,
        normalizedValue: computed,
        formula: output.expression,
        evidence,
      },
    });
    outputRefs.push({
      id: output.id,
      elementId: output.elementId,
      baseVersion,
      expression: output.expression,
      normalizedValue: computed,
    });
  }

  return {
    ok: true,
    bundle: {
      schema: 1,
      algorithmId: artifact.algorithmId,
      artifactHash,
      status: "passed",
      commitPolicy: "patch_bundle_only_runtime_must_cas",
      patches,
      writeLockedCellResultsArgs: {
        reason: `apply algorithm artifact ${artifact.algorithmId}`,
        ops: patches.map((patch) => ({
          elementId: patch.elementId,
          baseVersion: patch.baseVersion,
          value: patch.value.value,
          status: patch.value.status ?? "complete",
          confidence: patch.value.confidence ?? 1,
          normalizedValue: patch.value.normalizedValue,
          formula: patch.value.formula ?? "",
          evidence: patch.value.evidence ?? [],
          kind: "set" as const,
        })),
      },
      proof: {
        runnerVersion: ALGORITHM_ARTIFACT_RUNNER_VERSION,
        deterministic: true,
        testsPassed: artifact.tests?.length ?? 0,
        inputRefs,
        outputRefs,
      },
    },
  };
}

export async function runAlgorithmArtifactFromRoomTools(
  artifact: AlgorithmArtifact,
  rt: RoomTools,
  artifactId?: string,
): Promise<AlgorithmArtifactResult> {
  const validation = validateAlgorithmArtifact(artifact);
  if (!validation.ok) return validation;
  const elementIds = unique([
    ...artifact.inputs.map((input) => input.elementId),
    ...artifact.outputs.map((output) => output.elementId),
  ]);
  const cells = await rt.readRange(elementIds, artifactId);
  return runAlgorithmArtifact(artifact, snapshotFromCells(cells));
}

export function validateAlgorithmArtifact(artifact: AlgorithmArtifact): AlgorithmArtifactResult {
  const errors: string[] = [];
  const record = artifact as unknown as Record<string, unknown>;
  if (record.schema !== 1) errors.push("schema must be 1");
  if (!artifact.algorithmId?.trim()) errors.push("algorithmId is required");
  if (!artifact.name?.trim()) errors.push("name is required");
  if (artifact.kind !== "spreadsheet_formula") errors.push("only spreadsheet_formula artifacts are supported");
  if (artifact.language !== "formula_dsl" && artifact.language !== "noderoom_dsl") errors.push("language must be formula_dsl or noderoom_dsl");
  if (!Array.isArray(artifact.inputs) || artifact.inputs.length === 0) errors.push("at least one input is required");
  if (!Array.isArray(artifact.outputs) || artifact.outputs.length === 0) errors.push("at least one output is required");
  if (artifact.inputs?.length > (artifact.constraints?.maxInputs ?? 64)) errors.push("input count exceeds maxInputs");
  if (artifact.outputs?.length > (artifact.constraints?.maxOutputs ?? 64)) errors.push("output count exceeds maxOutputs");
  if (artifact.constraints?.deterministic === false) errors.push("deterministic must not be false");
  if (artifact.constraints?.noNetwork === false) errors.push("noNetwork must not be false");
  if (artifact.constraints?.noRandom === false) errors.push("noRandom must not be false");
  if (artifact.constraints?.noDateNow === false) errors.push("noDateNow must not be false");

  const inputIds = new Set<string>();
  const inputElementIds = new Set<string>();
  for (const input of artifact.inputs ?? []) {
    if (!isIdentifier(input.id)) errors.push(`invalid input id: ${input.id}`);
    if (!input.elementId?.trim()) errors.push(`input ${input.id} is missing elementId`);
    if (inputIds.has(input.id)) errors.push(`duplicate input id: ${input.id}`);
    if (inputElementIds.has(input.elementId)) errors.push(`duplicate input elementId: ${input.elementId}`);
    inputIds.add(input.id);
    inputElementIds.add(input.elementId);
  }

  const outputIds = new Set<string>();
  for (const output of artifact.outputs ?? []) {
    if (!isIdentifier(output.id)) errors.push(`invalid output id: ${output.id}`);
    if (outputIds.has(output.id)) errors.push(`duplicate output id: ${output.id}`);
    outputIds.add(output.id);
    if (!output.elementId?.trim()) errors.push(`output ${output.id} is missing elementId`);
    if (!["number", "currency", "percent", undefined].includes(output.format)) errors.push(`output ${output.id} has unsupported format`);
    const expressionErrors = validateExpression(output.expression, inputIds);
    for (const error of expressionErrors) errors.push(`output ${output.id}: ${error}`);
  }

  for (const test of artifact.tests ?? []) {
    for (const key of Object.keys(test.inputs ?? {})) {
      if (!inputIds.has(key)) errors.push(`test ${test.name} references unknown input ${key}`);
    }
    for (const key of Object.keys(test.expected ?? {})) {
      if (!outputIds.has(key)) errors.push(`test ${test.name} references unknown output ${key}`);
    }
  }

  if (errors.length) return { ok: false, errors, artifactHash: hashStable(artifact) };
  return { ok: true, bundle: emptyValidationBundle(artifact) };
}

export function snapshotFromCells(cells: CellView[]): Record<string, AlgorithmCellSnapshot> {
  const snapshot: Record<string, AlgorithmCellSnapshot> = {};
  for (const cell of cells) snapshot[cell.id] = { id: cell.id, value: cell.value, version: cell.version };
  return snapshot;
}

function emptyValidationBundle(artifact: AlgorithmArtifact): AlgorithmPatchBundle {
  return {
    schema: 1,
    algorithmId: artifact.algorithmId,
    artifactHash: hashStable(artifact),
    status: "passed",
    commitPolicy: "patch_bundle_only_runtime_must_cas",
    patches: [],
    writeLockedCellResultsArgs: {
      reason: `apply algorithm artifact ${artifact.algorithmId}`,
      ops: [],
    },
    proof: {
      runnerVersion: ALGORITHM_ARTIFACT_RUNNER_VERSION,
      deterministic: true,
      testsPassed: 0,
      inputRefs: [],
      outputRefs: [],
    },
  };
}

function runArtifactTests(artifact: AlgorithmArtifact): string[] {
  const errors: string[] = [];
  for (const test of artifact.tests ?? []) {
    const inputValues = new Map(Object.entries(test.inputs ?? {}));
    for (const output of artifact.outputs) {
      if (!(output.id in (test.expected ?? {}))) continue;
      const actual = evaluateExpression(output.expression, inputValues);
      const expected = test.expected[output.id];
      const tolerance = test.tolerance ?? 1e-9;
      if (Math.abs(actual - expected) > tolerance) {
        errors.push(`test ${test.name} failed for ${output.id}: expected ${expected}, got ${actual}`);
      }
    }
  }
  return errors;
}

function buildEvidence(
  artifact: AlgorithmArtifact,
  output: AlgorithmArtifactOutput,
  inputRefs: AlgorithmPatchBundle["proof"]["inputRefs"],
): CellEvidence[] {
  return [
    {
      id: `computed:${artifact.algorithmId}:${output.id}`,
      kind: "computed",
      label: output.label ?? `${artifact.name} / ${output.id}`,
      source: `algorithm:${artifact.algorithmId}:${hashStable(artifact)}`,
      snippet: `${output.id} = ${output.expression}`,
      confidence: 1,
    },
    ...inputRefs.map((ref): CellEvidence => ({
      id: `source:${artifact.algorithmId}:${output.id}:${ref.id}`,
      kind: "source",
      label: `source cell ${ref.id}`,
      source: ref.elementId,
      snippet: `${ref.elementId} v${ref.version}`,
      confidence: 1,
    })),
  ];
}

function validateExpression(expression: string, inputIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!expression?.trim()) return ["expression is required"];
  try {
    const tokens = tokenize(expression);
    for (const token of tokens) {
      if (token.type === "identifier" && !inputIds.has(token.value)) errors.push(`unknown identifier ${token.value}`);
    }
    const parser = new ExpressionParser(tokens, new Map([...inputIds].map((id) => [id, 1])));
    parser.parse();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

function evaluateExpression(expression: string, values: Map<string, number>): number {
  return new ExpressionParser(tokenize(expression), values).parse();
}

type Token =
  | { type: "number"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push({ type: "number", value: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index++;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index++;
      continue;
    }
    throw new Error(`unsupported token at ${index}: ${char}`);
  }
  if (!tokens.length) throw new Error("expression is empty");
  return tokens;
}

class ExpressionParser {
  private index = 0;

  constructor(private tokens: Token[], private values: Map<string, number>) {}

  parse(): number {
    const value = this.expression();
    if (this.peek()) throw new Error(`unexpected token ${this.peek()!.value}`);
    return value;
  }

  private expression(): number {
    let value = this.term();
    while (this.peek()?.type === "operator" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const operator = this.take()!.value;
      const right = this.term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private term(): number {
    let value = this.factor();
    while (this.peek()?.type === "operator" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const operator = this.take()!.value;
      const right = this.factor();
      if (operator === "/" && right === 0) throw new Error("division by zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private factor(): number {
    const token = this.take();
    if (!token) throw new Error("unexpected end of expression");
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      const value = this.factor();
      return token.value === "-" ? -value : value;
    }
    if (token.type === "number") return Number(token.value);
    if (token.type === "identifier") {
      const value = this.values.get(token.value);
      if (value === undefined) throw new Error(`missing value for ${token.value}`);
      return value;
    }
    if (token.type === "paren" && token.value === "(") {
      const value = this.expression();
      const close = this.take();
      if (close?.type !== "paren" || close.value !== ")") throw new Error("missing closing parenthesis");
      return value;
    }
    throw new Error(`unexpected token ${token.value}`);
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private take(): Token | undefined {
    return this.tokens[this.index++];
  }
}

function parseCellNumber(value: unknown): number | null {
  const raw = value && typeof value === "object" && "value" in (value as Record<string, unknown>)
    ? (value as CellPayload).value
    : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const percent = trimmed.endsWith("%");
  const cleaned = trimmed.replace(/[$,\s%]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

function formatOutputValue(value: number, format: AlgorithmOutputFormat): number | string {
  if (format === "number") return round(value);
  if (format === "currency") return `${value < 0 ? "-" : ""}$${Math.abs(round(value)).toLocaleString("en-US")}`;
  return `${value >= 0 ? "+" : ""}${round(value * 100, 1).toFixed(1)}%`;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hashStable(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}
