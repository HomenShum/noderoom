/**
 * Minimal Excel number-format renderer for the cell formats that actually occur in uploaded
 * finance workbooks: General, fixed decimals, thousands grouping, percent, currency, paren
 * negatives, and quoted literal suffixes ("x", "days"). NOT a full SSF implementation — every
 * supported token is tested, everything else falls back to the raw value (HONEST display: an
 * unknown format must never silently misrender a number).
 *
 * Pattern grammar handled: sections split by ';' (positive;negative;zero), '0'/'#' digit
 * placeholders with ',' grouping and '.' decimals, '%' scaling, leading '$', '[$...]' currency
 * tags, '[Red]'-style color tags (stripped), '_'/'*' padding (stripped), '"literal"' passthrough,
 * '(' ')' negative wrapping.
 */

const LIT = ""; // sentinel protecting quoted literals through token stripping

export function formatExcelNumber(raw: number, fmt: string | undefined): string {
  if (!Number.isFinite(raw)) return String(raw);
  if (!fmt || fmt === "General" || fmt === "@") return formatGeneral(raw);
  const sections = fmt.split(";");
  if (raw < 0 && sections.length >= 2) {
    // The negative section carries its own sign decoration (parens or a literal '-').
    return renderSection(Math.abs(raw), sections[1], "neg-section");
  }
  if (raw === 0 && sections.length >= 3) return renderSection(0, sections[2], "pos");
  if (raw < 0) return renderSection(Math.abs(raw), sections[0], "neg-minus");
  return renderSection(raw, sections[0], "pos");
}

type SignMode = "pos" | "neg-minus" | "neg-section";

function renderSection(value: number, section: string, mode: SignMode): string {
  // Strip color tags + padding/fill tokens; capture currency tags like [$USD] / [$$-409].
  let currency = "";
  let cleaned = section
    .replace(/\[(?:Red|Blue|Green|Black|White|Magenta|Cyan|Yellow)\]/gi, "")
    .replace(/\[\$([^\]-]*)[^\]]*\]/g, (_m, sym: string) => { currency = sym || "$"; return ""; })
    .replace(/_./g, "")
    .replace(/\*./g, "");

  // Protect quoted literals from token parsing; the sentinel survives stripTokens.
  // Index encoded as a LETTER (A,B,C…) — a digit index would collide with the '0'/'#'
  // digit-placeholder scan below and corrupt the mask boundaries.
  const literals: string[] = [];
  cleaned = cleaned.replace(/"([^"]*)"/g, (_m, lit: string) => {
    literals.push(lit);
    return LIT + String.fromCharCode(64 + literals.length) + LIT;
  });

  const percent = cleaned.includes("%");
  const parens = cleaned.includes("(") && cleaned.includes(")");
  const grouping = /[#0],[#0]/.test(cleaned);
  const decMatch = cleaned.match(/\.([0#]+)/);
  const decimals = decMatch ? decMatch[1].length : 0;
  const dollar = currency || (cleaned.includes("$") ? "$" : "");

  const scaled = percent ? value * 100 : value;
  const body = scaled.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });

  // Literal prefix/suffix = quoted literals around the digit mask (sentinels survive the strip).
  const firstDigit = cleaned.search(/[#0]/);
  const lastDigit = Math.max(cleaned.lastIndexOf("#"), cleaned.lastIndexOf("0"));
  const stripTokens = (s: string) => s.replace(/[#0,.%$() -]/g, "");
  const litPattern = new RegExp(LIT + "([A-Z])" + LIT, "g");
  const restore = (s: string) => s.replace(litPattern, (_m, i: string) => literals[i.charCodeAt(0) - 65] ?? "");
  const prefix = firstDigit > 0 ? restore(stripTokens(cleaned.slice(0, firstDigit))) : "";
  const suffix = lastDigit >= 0 ? restore(stripTokens(cleaned.slice(lastDigit + 1))) : "";

  let out = `${prefix}${dollar}${body}${percent ? "%" : ""}${suffix}`;
  if (mode === "neg-section") out = parens ? `(${out})` : `-${out}`;
  else if (mode === "neg-minus") out = `-${out}`;
  return out;
}

function formatGeneral(raw: number): string {
  if (Number.isInteger(raw)) return String(raw);
  // Excel's General trims to ~10 significant digits and drops trailing zeros.
  return String(Number(raw.toPrecision(10)));
}
