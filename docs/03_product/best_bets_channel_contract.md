# Best Bets Channel Contract

## Purpose

`Best Bets` is Unit Talk's premium high-signal execution channel for the top actionable plays on the board.

It is the clearest channel expression of the Trader Room concept:
- fewer plays
- stronger edges
- cleaner presentation
- direct utility for members who want the best opportunities, not the full content stream

## Identity First, Rollout Second

Best Bets must be defined primarily by product role, not by rollout convenience.

Primary identity:
- execution board
- high-signal lane
- selective premium board

Secondary rollout fact:
- it is also the first non-canary production lane in V2

The rollout fact matters operationally, but it is not the core meaning of the channel.

## What Best Bets Is

Best Bets is:
- the primary high-conviction execution board
- a filtered subset of the strongest opportunities
- presentation-ready for immediate member action
- intentionally constrained in volume

Best Bets is not:
- a general picks feed
- a capper activity stream
- a research dump
- a chatter room
- a test/debug lane
- a catch-all premium channel

## Trader Room Relationship

Within the Trader Room concept:

- Best Bets = execution board
- Trader Insights = edge and market-context board
- Strategy Lab = deeper research and pattern board
- Cappers Space = broader capper ecosystem

This separation is required to keep Best Bets from turning into a noisy duplicate of other channels.

## Allowed Content

A play may be promoted to Best Bets only if it is:
- approved by the canonical pipeline
- among the top-ranked opportunities for the slate
- supported by confidence, edge, EV, matchup, or ranking criteria
- presentation-ready for direct member action
- limited enough in volume to preserve signal quality

## Prohibited Content

Do not use Best Bets for:
- every approved pick
- raw capper submissions
- thread chatter
- long-form research dumps
- testing or debug traffic
- noisy update spam
- broad recaps
- experimental or shadow-only outputs

## Posting Philosophy

Best Bets follows:
- quality over quantity
- signal over volume
- execution over commentary

Every post should feel:
- high conviction
- high clarity
- high actionability
- low noise

## Volume Rule

Best Bets must remain intentionally constrained.

It should feel selective, not busy.
If the lane starts to resemble the full approved feed, the channel has drifted from its purpose.

## Routing Rule

Best Bets is not the destination for all approved picks.
It is a promotion tier above baseline approval.

Approval into the canonical pipeline is necessary but not sufficient for Best Bets.

## Rollout Rule

Best Bets can be the first non-canary production lane after `discord:canary`, but that is a rollout decision layered on top of the product role.

Do not define the channel primarily as:
- "the safest first lane after canary"

Define it primarily as:
- "the premium high-signal execution board"

## V1 Implementation Rule

For V1:
- keep Best Bets as a single-pick execution lane until batching or daily compilation is explicitly designed
- preserve the high-signal standard even if the underlying implementation still posts one pick at a time
- do not use the lane as a surrogate for a generic approved-picks feed

## Operating Test

Ask this before posting:

"Does this belong on the high-signal execution board, or is it merely approved?"

If the answer is only "approved," it should not go to Best Bets.
