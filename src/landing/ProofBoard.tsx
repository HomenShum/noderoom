/**
 * ProofBoard — the closing "why it matters" board. Source → output → proof,
 * every row green. The artifact still feels like Excel; the audit trail feels
 * like Git; the result is ready for review.
 */
import { Check } from "lucide-react";
import { PROOF_ROWS } from "./storyTape";

export function ProofBoard() {
  return (
    <div className="rs-proof">
      <div className="rs-proof-grid" role="table" aria-label="Proof board">
        <div className="rs-proof-row rs-proof-head" role="row">
          <span role="columnheader">Source document</span>
          <span role="columnheader">NodeRoom output</span>
          <span role="columnheader">Proof</span>
        </div>
        {PROOF_ROWS.map((row) => (
          <div className="rs-proof-row" role="row" key={row.proof}>
            <span role="cell" className="rs-proof-src">{row.source}</span>
            <span role="cell" className="rs-proof-out">{row.output}</span>
            <span role="cell" className="rs-proof-badge">
              <Check size={13} /> {row.proof} <b>PASS</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
