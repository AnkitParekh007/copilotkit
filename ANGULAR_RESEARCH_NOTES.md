# Angular Research Notes

## Goal

Study which CopilotKit and AG-UI ideas can carry into Angular copilot architecture without pretending that the current upstream project is Angular-native.

## What Maps Well To Angular

### 1. Event-driven agent UI

Angular is well suited to:

- projecting AG-UI streams into signals or RxJS observables
- separating transport, state projection, and presentation
- building operator-facing trace panels and approval surfaces

### 2. Human-in-the-loop flows

Interrupt handling maps cleanly to Angular UI state machines:

- approval cards
- side panels
- resumable forms
- step-specific confirmation UI

### 3. Generative UI as a rendering contract

Angular can consume declarative or protocol-defined UI payloads if the system is designed around:

- explicit schemas
- trusted render boundaries
- dynamic component registration
- sandboxed or constrained rendering where needed

## React-First Patterns To Avoid Copying Blindly

- direct hook-for-hook API translation
- assuming every UI extension point should be a component-returning callback
- coupling state access to React context patterns
- relying on Next.js conventions as if they were framework-agnostic

## What Needs Angular-Specific Adaptation

### 1. State model

Angular should likely expose:

- signals for current agent/session state
- observable event streams for raw protocol events
- derived view models for chat, tools, trace, and approvals

### 2. Dynamic rendering

Instead of React render callbacks, Angular likely needs:

- component registries
- outlet-based rendering
- typed input adapters
- lifecycle-safe cleanup around streamed component instances

### 3. App integration

Angular applications will likely want:

- DI-friendly runtime clients
- route-aware thread/session management
- SSR-safe boundaries where applicable
- composable directives for agent-aware UI elements

## Likely Deliverables For Angular Work

- an Angular SDK focused on transport, state, and rendering contracts
- starter examples that demonstrate chat, tool rendering, and interrupt handling
- trace and debug UI patterns suitable for enterprise apps
- documentation that distinguishes protocol concepts from React implementation details

## Contribution Ideas

- framework-neutral AG-UI documentation examples
- guidance for protocol consumers outside React
- clearer separation in docs between AG-UI concepts and React package APIs
- examples of event inspectors, trace viewers, or interrupt UIs that generalize well
