import { runwayChartSvg } from "../skills/finance/runwayForecaster";

export { runwayChartSvg as renderRunwayChartSvg } from "../skills/finance/runwayForecaster";
export type { RunwayResult } from "../skills/finance/runwayForecaster";

export interface RunwayChartProps {
  resultHtml: string;
}

export function RunwayChart({ resultHtml }: RunwayChartProps) {
  return <div dangerouslySetInnerHTML={{ __html: resultHtml }} />;
}

export function renderRunwayChart(result: Parameters<typeof runwayChartSvg>[0]): string {
  return runwayChartSvg(result);
}