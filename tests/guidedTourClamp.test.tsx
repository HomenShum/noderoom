// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuidedTour, type TourStep } from "../src/ui/GuidedTour";

// B2 regression: GuidedTour's render guard checked steps.length === 0 but not i >= steps.length, so
// when the steps array shrank (e.g. mobile-gated steps) while the tour stayed open with a stale index,
// it dereferenced steps[i] === undefined and crashed. The fix clamps the index at the render read.

const step = (title: string): TourStep => ({ title, body: `body-${title}` });

describe("GuidedTour clamps a stale step index (B2 crash)", () => {
  it("does not crash when the steps array shrinks below the current index", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <GuidedTour steps={[step("one"), step("two"), step("three")]} open onClose={onClose} />,
    );

    // Advance to the last step (i = 2).
    fireEvent.click(screen.getByTestId("tour-next")); // 0 -> 1
    fireEvent.click(screen.getByTestId("tour-next")); // 1 -> 2
    expect(screen.getByText("3 / 3")).toBeTruthy();

    // Steps shrink while the tour stays open and i is stale. Pre-fix: steps[2] undefined -> TypeError.
    expect(() =>
      rerender(<GuidedTour steps={[step("one"), step("two")]} open onClose={onClose} />),
    ).not.toThrow();
    expect(screen.getByTestId("guided-tour")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy(); // clamped to the new last step
  });
});
