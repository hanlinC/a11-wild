import type { CalibrationPage } from "@a11-wild/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Calibration } from "./calibration";

const page = (picks: CalibrationPage["picks"]): CalibrationPage => ({ picks });

describe("Calibration page", () => {
  it("shows how often the owner picked the critic's first place, and says when the sample is small", async () => {
    stubApi({
      "GET /api/calibration": () => ({
        body: page({ firstPlace: { k: 1, n: 3, value: 0.333, interval: [0.061, 0.792], note: "small sample: direction only, no conclusion" }, byPlace: { "1": 1, "3": 2 } }),
      }),
    });
    renderSignedIn(<Calibration />);
    expect(await screen.findByText("You picked the critic's first place 1 of 3 times.")).toBeInTheDocument();
    expect(screen.getByText(/Its first: 1 · Its third: 2 · A small sample/)).toBeInTheDocument();
  });

  it("says plainly when no pick stands beside a rank yet", async () => {
    stubApi({ "GET /api/calibration": () => ({ body: page({ firstPlace: { k: 0, n: 0, value: null, interval: null }, byPlace: {} }) }) });
    renderSignedIn(<Calibration />);
    expect(await screen.findByText(/No pick yet beside a rank/)).toBeInTheDocument();
  });
});
