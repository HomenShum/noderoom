export interface VersionedCellRef {
  artifactId: string;
  elementId: string;
  version: number;
}

export interface VersionCheck {
  ok: boolean;
  expected: number;
  actual: number;
}

export function checkBaseVersion(ref: VersionedCellRef, actualVersion: number): VersionCheck {
  return { ok: ref.version === actualVersion, expected: ref.version, actual: actualVersion };
}

export function nextVersion(version: number): number {
  return Math.max(0, Math.floor(version)) + 1;
}

