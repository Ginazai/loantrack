/**
 * Normalizes an axios/API error into a single displayable string.
 *
 * FastAPI's `detail` field is NOT always a string:
 *  - A raised `HTTPException(status_code, "message")` -> `detail` is a string.
 *  - A 422 Pydantic validation error -> `detail` is an ARRAY of
 *    `{ loc, msg, type }` objects, e.g.:
 *      { "detail": [{ "loc": ["body","password"], "msg": "String should have
 *        at least 8 characters", "type": "string_too_short" }] }
 *
 * Rendering that array directly as `{error}` in JSX throws "Objects are not
 * valid as a React child" — which is why a 422 was crashing the form instead
 * of showing a message. This always returns a plain, safe-to-render string.
 */
export function getApiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  const detail = (error as any)?.response?.data?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        const field = Array.isArray(item?.loc) ? item.loc.at(-1) : undefined;
        const msg = item?.msg ?? "Invalid value";
        return field ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }

  if ((error as any)?.message === "Network Error") {
    return "Can't reach the server — check your connection and try again";
  }

  return fallback;
}
