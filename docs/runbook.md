# HopReady API runbook

For whoever is on call for the API (`apps/api`, Cloudflare Workers worker `hopready-api`). Commands assume the repository root and a shell with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exported:

```sh
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -s hopready -a CLOUDFLARE_API_TOKEN -w)"
export CLOUDFLARE_ACCOUNT_ID="$(security find-generic-password -s hopready -a CLOUDFLARE_ACCOUNT_ID -w)"
cd apps/api
```

## Is it up?

```sh
curl --fail --max-time 15 "$API_BASE_URL/v1/health"
```

A healthy answer is `{"status":"ok", ...}` with every provider `configured`. Health makes no provider calls, so it shows the Worker is serving, not that TfNSW or Apple are answering.

## Symptom: the app says "HopReady is busy" or shows 429 or 503

1. **Mitigate.** Nothing to do for a single user hitting per-install limits; they reset within a minute.
2. **Confirm** which limit fired. In the Cloudflare dashboard, open Workers & Pages > hopready-api > Logs and filter `level:"warn"`:
   - `"failure":"rate-limited"` with `provider` set means a provider limit (TfNSW 403 or Apple 429) or our daily budget for it;
   - a 429 without a provider means our own per-client limit.
3. **TfNSW over quota** (`X-Error-Detail: Account Over Rate Limit/Quota`): lasts until the TfNSW daily reset. Longer term, ask TfNSW for a higher quota (free).
4. **Apple over 25,000 calls a day:** drive times are unavailable until Apple's daily reset. Public transport options still work. Longer term, request a quota increase (form linked in docs/providers.md).
5. **Our daily budget exhausted** (`TFNSW_DAILY_CALL_BUDGET` or `APPLE_MAPS_DAILY_CALL_BUDGET`): raise it only if the provider limit allows:

   ```sh
   npx wrangler deploy --var APPLE_MAPS_DAILY_CALL_BUDGET:22000
   ```

## Symptom: requests fail with Cloudflare Error 1102 or 1027

These come from Cloudflare, not from HopReady, and only on the Workers Free plan.

1. **Confirm.** Error 1102 means a request ran past the CPU limit (10 ms on Free). Error 1027 means the account used its 100,000 free requests for the day. In the dashboard, Workers & Pages > hopready-api > Metrics shows the errors; Logs show the outcome for each request.
2. **Mitigate.** Both stop on Workers Paid (US$5/month: 30 seconds of CPU per request by default, and no daily cap). Moving to Paid needs the owner's approval (docs/OWNER-ACTIONS.md, item 3). Without it, Error 1027 clears at the daily reset (00:00 UTC, 11 am in Sydney during daylight saving), and nothing short of Paid stops Error 1102 on slow requests.
3. **Verify.** Plan one trip in the app, and check Metrics for new errors.

## Symptom: plans fail with 502 or 504

1. **Check the providers directly.** Use the dev key from the Keychain; never paste keys into tickets.

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: apikey $(security find-generic-password -s hopready -a TFNSW_API_KEY -w)" \
     'https://api.transport.nsw.gov.au/v1/tp/stop_finder?outputFormat=rapidJSON&type_sf=any&name_sf=Central&coordOutputFormat=EPSG:4326&TfNSWSF=true'
   ```

2. **TfNSW down:** check the Open Data forum (https://opendataforum.transport.nsw.gov.au). The app already explains the failure to users, so there is nothing to change on our side.
3. **`malformed-response`:** a provider changed its response shape. Record a sample with `apps/api/scripts/record-tfnsw-samples.ts`, update the schema in `apps/api/src/providers/tfnsw/`, run the tests, and deploy.

## Rolling back a bad deploy

1. **Mitigate first.** Roll back to the previous version:

   ```sh
   npx wrangler deployments list
   npx wrangler rollback            # previous version; add a version ID to pick a specific one
   ```

2. **Verify:** `curl --fail "$API_BASE_URL/v1/health"`, then plan one trip in the app.
3. **Then fix.** Fix forward on a branch and deploy through the "Deploy API" workflow.

## Rotating a key

1. Create the new key at the provider (TfNSW API Tokens page, or a new Apple Maps key).
2. Update the GitHub secret, then run the "Deploy API" workflow. Or update the Worker directly:

   ```sh
   npx wrangler secret put TFNSW_API_KEY            # paste at the prompt
   ```

3. Check `/v1/health`, then plan one trip.
4. Revoke the old key at the provider.

## When to escalate

Escalate to the owner if:

- plans fail for more than 30 minutes after the provider status pages show the provider is up;
- a rollback does not restore `/v1/health`;
- a key may have leaked (rotate first, then tell the owner).
