# Bootstrap Plan

## Phase 0

- Ratify repo shape
- Ratify core contracts
- Stand up Linear, Notion, Slack, and Supabase specs

## Phase 1

- Establish submission path
- Establish canonical schema
- Establish lifecycle skeleton

## Phase 2

- Establish distribution outbox flow
- Establish worker claim/retry/sent behavior
- Establish receipt and audit capture
- Prove the first live canary delivery

## Phase 3

- Establish canary-safe Discord embed delivery
- Establish read-only operator visibility over outbox, runs, receipts, and picks
- Keep all live posting constrained to `discord:canary`
- Use operator visibility and repeated live canaries to decide when the next target can graduate
