import { describe, it, expect } from "vitest";
import { parseMethodCall } from "../single-route-helpers";

const jsonRequest = (raw: string): Request =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });

describe("parseMethodCall — JSON envelope shape guard", () => {
  it.each([
    { name: "null body", body: "null" },
    { name: "numeric body", body: "42" },
    { name: "string body", body: '"hello"' },
    { name: "array body", body: "[1,2,3]" },
  ])("rejects $name with 400 (Invalid JSON envelope)", async ({ body }) => {
    let caught: unknown;
    try {
      await parseMethodCall(jsonRequest(body));
    } catch (err) {
      caught = err;
    }
    // parseMethodCall throws Response objects, not Errors
    expect(caught).toBeInstanceOf(Response);
    const response = caught as Response;
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      error: "invalid_request",
      message: "Invalid JSON envelope",
    });
  });

  it("accepts a well-formed object envelope", async () => {
    const result = await parseMethodCall(
      jsonRequest(JSON.stringify({ method: "info", params: { foo: "bar" } })),
    );
    expect(result.method).toBe("info");
    expect(result.params).toEqual({ foo: "bar" });
  });
});
