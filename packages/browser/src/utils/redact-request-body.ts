import { Predicate } from "effect";
import { MAX_NETWORK_BODY_LENGTH, SENSITIVE_BODY_KEY_PATTERN } from "../mcp/constants";

const truncate = (body: string): string =>
  body.length <= MAX_NETWORK_BODY_LENGTH
    ? body
    : `${body.slice(0, MAX_NETWORK_BODY_LENGTH)}… [truncated ${body.length - MAX_NETWORK_BODY_LENGTH} chars]`;

const REDACTED = "[redacted]";

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!Predicate.isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_BODY_KEY_PATTERN.test(key) ? REDACTED : redactValue(nested),
    ]),
  );
};

const redactJson = (body: string): string | undefined => {
  try {
    return JSON.stringify(redactValue(JSON.parse(body)));
  } catch {
    return undefined;
  }
};

const redactForm = (body: string): string | undefined => {
  if (!/^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/.test(body)) return undefined;

  const params = new URLSearchParams(body);
  const redacted = new URLSearchParams();
  for (const [key, value] of params) {
    redacted.append(key, SENSITIVE_BODY_KEY_PATTERN.test(key) ? REDACTED : value);
  }
  return redacted.toString();
};

// HACK: expect drives real logged-in sessions, so a login POST carries a real password. Only
// bodies whose structure we can walk are kept, with secret-looking keys blanked; anything
// opaque (multipart, binary) is reduced to its shape, since a partial redaction of a format
// we do not understand would read as safe without being it.
export const redactRequestBody = (
  body: string | null,
  contentType: string | undefined,
): string | undefined => {
  if (body === null || body.length === 0) return undefined;

  const structured = redactJson(body) ?? redactForm(body);
  if (structured !== undefined) return truncate(structured);

  return `[body not captured: ${contentType ?? "unknown content type"}, ${body.length} chars]`;
};
