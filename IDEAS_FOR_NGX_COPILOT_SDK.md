# Ideas For ngx-copilot-sdk

## Context

This document captures how research from this CopilotKit fork may inform [ngx-copilot-sdk](https://github.com/AnkitParekh007/ngx-copilot-sdk) and related Angular work such as [angular-ai-copilot-starter](https://github.com/AnkitParekh007/angular-ai-copilot-starter).

## Principles

- do not pretend to be CopilotKit
- reuse protocol and architectural ideas where they are strong
- design Angular APIs for Angular developers, not as thin React imitations
- keep framework-specific layers separate from protocol-level concerns

## Possible SDK Directions

### 1. AG-UI client layer

A thin Angular-friendly client could provide:

- connection/session lifecycle
- raw event stream access
- signal-based current state
- typed event adapters for tools, interrupts, and traces

### 2. Dynamic tool rendering

Possible Angular abstractions:

- tool renderer registry
- directive or component-based tool host
- typed adapters from tool payload to Angular component inputs
- loading, error, and retry rendering hooks

### 3. Interrupt and approval APIs

Potential features:

- pending interrupt stores
- resumable action helpers
- approval form helpers
- standard confirmation UI primitives

### 4. Trace and observability surfaces

Useful portfolio-quality features:

- event inspector panel
- agent timeline view
- tool execution cards
- state diff or session replay views

## What To Borrow From CopilotKit

- protocol mindset around agent <> UI interaction
- support for human-in-the-loop workflows
- explicit tool rendering patterns
- emphasis on generative UI as a first-class product capability

## What Not To Copy Blindly

- React hooks as the public API shape
- Next.js-specific setup assumptions
- component-returning callbacks as the only extension mechanism
- naming that implies official compatibility where only conceptual alignment exists

## Public Portfolio Value

This fork supports a public portfolio by showing:

- protocol-level analysis rather than superficial cloning
- cross-framework architectural comparison
- a credible path from research to original Angular implementation
- evidence that `ngx-copilot-sdk` is informed by real ecosystem study

## Possible Upstream Contribution Ideas

- docs clarifications for non-React consumers
- framework-neutral AG-UI examples
- trace/event-inspection patterns
- clearer articulation of generative UI protocol layers versus React rendering layers
