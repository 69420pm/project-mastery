# Gemini API free tier

With `AI_PROVIDER=google` every model call spends the user's free-tier quota (key in `.env.local`, ADR 0006). Quotas are per project and per model. Last verified 2026-10-09.

| Model                                                     | RPM | TPM  | RPD |
| --------------------------------------------------------- | --- | ---- | --- |
| `gemini-3.8-flash`, `3.7-flash`, `3.6-flash`, `3.5-flash` | 5   | 250k | 20  |
| `gemini-3.5-flash-lite`                                   | 15  | 250k | 900 |

RPM is requests per minute, TPM tokens per minute, RPD requests per day. **RPD is almost always the bottleneck**: the four flash models allow 20 calls a day, so one eval run can use a day's budget. Retries count as requests. Run live smoke tests on flash-lite, keep flash models for the few calls that need them, and use `AI_PROVIDER=mock` for everything else.

## Telling errors apart

A 429 is almost always quota, but read the body before deciding. Verified against the live API:

| Status | `error.status`       | Meaning                                                                                                                               |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 429    | `RESOURCE_EXHAUSTED` | Quota used up. `details` has a `QuotaFailure` with `quotaId` and a `RetryInfo` with `retryDelay`.                                     |
| 400    | `INVALID_ARGUMENT`   | Malformed request. Not a 429: `details` lists `fieldViolations`.                                                                      |
| 404    | `NOT_FOUND`          | Unknown model id.                                                                                                                     |
| 503    | `UNAVAILABLE`        | Google-side demand spike. Not quota, and it clears by itself: retrying later works, and a "rate limited" flash model may just be 503. |

The `quotaId` of a 429 names the limit that was hit (only the RPM id was seen live; the other two are the expected names):

- `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`: RPM. `retryDelay` is seconds, so waiting works.
- `...PerDay...`: RPD. Waiting does not help until the daily reset, so stop calling the model.
- A `...Token...` id: TPM. Send smaller prompts or wait a minute.

Example RPM 429, message trimmed:

```json
{
  "error": {
    "code": 429,
    "status": "RESOURCE_EXHAUSTED",
    "message": "You exceeded your current quota... Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite\nPlease retry in 11.4s.",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        "violations": [
          {
            "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            "quotaValue": "15"
          }
        ]
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        "retryDelay": "11s"
      }
    ]
  }
}
```

In the AI SDK the status is `statusCode` on the `APICallError` inside the `RetryError` (see `ai-sdk.md`), and the raw body is `responseBody`.

## Checking remaining quota

There is no way to ask the API key for remaining quota or usage:

- Responses carry no rate-limit headers, only `usageMetadata` with that call's token counts.
- `GET /v1beta/models/<id>` returns token limits, not quotas.
- Nothing like `/quota` exists (404), and the Service Usage API (`consumerQuotaMetrics`) answers 403 because it is not enabled for the key's project and needs OAuth, not an API key.
- The only view is the dashboard at https://ai.dev/rate-limit, which the user can open.

So an agent finds out by spending a request: send a tiny prompt (`"hi"`, `maxOutputTokens: 5`) to the model and read the status. That costs one RPD, so do it on flash-lite or not at all. `countTokens` is free of generation quota and is the way to size a prompt against TPM.

## Odd behaviour seen

- A call to `gemini-3.7-flash` came back with `modelVersion: gemini-3.8-flash`, so older ids may be aliases and may share a quota. Check `modelVersion` before assuming which model answered.
- Thinking tokens (`thoughtsTokenCount`) count towards TPM and cost, and a flash call for "hi" used over 100 of them.
