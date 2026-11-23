import { describe, it, expect } from "vitest";
import { parseCSV } from "../BatchCreateTab";

/**
 * parseCSV builds its column-index map from the header row, so it should
 * require all REQUIRED_HEADERS by exact name but tolerate them appearing in
 * any column order (issue #930).
 */
describe("BatchCreateTab parseCSV", () => {
  it("parses rows correctly when required headers are present but reordered", () => {
    const csv = [
      "token,recipient,cliff_days,amount,duration",
      "USDC,GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL,0,100,2592000",
      "XLM,GDEF3XYZKQNP7LKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XABC,30,250,7776000",
    ].join("\n");

    const { rows, headerError } = parseCSV(csv);

    expect(headerError).toBeNull();
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      rowIndex: 2,
      recipient: "GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL",
      amount: "100",
      duration: "2592000",
      cliff_days: "0",
      token: "USDC",
    });

    expect(rows[1]).toMatchObject({
      rowIndex: 3,
      recipient: "GDEF3XYZKQNP7LKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XABC",
      amount: "250",
      duration: "7776000",
      cliff_days: "30",
      token: "XLM",
    });
  });

  it("still parses correctly with headers in the original order", () => {
    const csv = [
      "recipient,amount,duration,cliff_days,token",
      "GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL,100,2592000,0,USDC",
    ].join("\n");

    const { rows, headerError } = parseCSV(csv);

    expect(headerError).toBeNull();
    expect(rows[0]).toMatchObject({
      recipient: "GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL",
      amount: "100",
      duration: "2592000",
      cliff_days: "0",
      token: "USDC",
    });
  });

  it("rejects a CSV missing a required header even if others are reordered", () => {
    const csv = [
      "token,recipient,amount,duration",
      "USDC,GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL,100,2592000",
    ].join("\n");

    const { rows, headerError } = parseCSV(csv);

    expect(headerError).toMatch(/cliff_days/);
    expect(rows).toHaveLength(0);
  });
});
