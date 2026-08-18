import { describe, expect, it } from "vite-plus/test";
import { redactRequestBody } from "../src/utils/redact-request-body";
import { MAX_NETWORK_BODY_LENGTH } from "../src/mcp/constants";

const JSON_TYPE = "application/json";
const FORM_TYPE = "application/x-www-form-urlencoded";

describe("redactRequestBody", () => {
  it("returns undefined for a request without a body", () => {
    expect(redactRequestBody(null, undefined)).toBeUndefined();
    expect(redactRequestBody("", JSON_TYPE)).toBeUndefined();
  });

  it("keeps the payload an agent needs to verify", () => {
    const body = redactRequestBody(
      JSON.stringify({ email: "user@example.com", quantity: 3, agreed: true }),
      JSON_TYPE,
    );

    expect(body).toContain("user@example.com");
    expect(body).toContain("3");
  });

  it("redacts secret-looking keys in JSON, at any depth", () => {
    const body = redactRequestBody(
      JSON.stringify({
        email: "user@example.com",
        password: "hunter2",
        nested: { apiKey: "sk-live-123", refresh_token: "rt-456", label: "keep me" },
        cards: [{ cardNumber: "4111111111111111" }],
      }),
      JSON_TYPE,
    );

    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("sk-live-123");
    expect(body).not.toContain("rt-456");
    expect(body).not.toContain("4111111111111111");
    expect(body).toContain("user@example.com");
    expect(body).toContain("keep me");
  });

  it("redacts secret-looking keys in a form-encoded body", () => {
    const body = redactRequestBody("username=alice&password=hunter2&remember=1", FORM_TYPE);

    expect(body).not.toContain("hunter2");
    expect(body).toContain("username=alice");
    expect(body).toContain("remember=1");
  });

  it("drops a body whose structure it cannot walk", () => {
    const body = redactRequestBody(
      '------boundary\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n',
      "multipart/form-data; boundary=boundary",
    );

    expect(body).not.toContain("hunter2");
    expect(body).toContain("not captured");
    expect(body).toContain("multipart/form-data");
  });

  it("names the content type as unknown when the request did not send one", () => {
    expect(redactRequestBody("not json, not a form", undefined)).toContain("unknown content type");
  });

  it("truncates a long body and says by how much", () => {
    const body = redactRequestBody(
      JSON.stringify({ note: "x".repeat(MAX_NETWORK_BODY_LENGTH * 2) }),
      JSON_TYPE,
    );

    expect(body!.length).toBeLessThan(MAX_NETWORK_BODY_LENGTH + 100);
    expect(body).toContain("truncated");
  });
});
