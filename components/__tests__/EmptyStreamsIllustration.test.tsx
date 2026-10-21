import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import axe from "axe-core";
import EmptyStreamsIllustration from "../EmptyStreamsIllustration";

afterEach(cleanup);

describe("EmptyStreamsIllustration accessibility", () => {
  it("exposes a descriptive image name and passes axe", async () => {
    const { container, getByRole } = render(<EmptyStreamsIllustration />);

    expect(getByRole("img", { name: "No streams created yet" })).toBeInTheDocument();
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
