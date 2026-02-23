# htn-plan

> **Mission Planning: The Hierarchical Task Network (HTN) Engine**  
> A pure TypeScript library that decomposes vague, high-level goals into a flat, ordered list of executable micro-tasks.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-jest-green)](https://jestjs.io/)

---

## Why an HTN instead of a Finite State Machine?

When you give a system a **massive, vague goal** ("Clean the house", "Write a German learning app"), a Finite State Machine breaks — it's too rigid to handle open-ended decomposition.

Autonomous systems instead use an **HTN**:

| Concept | Description |
|---|---|
| **Compound Task** | An abstract goal that cannot be executed directly (e.g. `"FetchCoffee"`). |
| **Method** | A recipe that decomposes one Compound Task into an ordered list of Sub-Tasks. Multiple methods can exist for the same task; the first one whose *precondition* passes is used. |
| **Operator (Primitive Task)** | A directly executable action with a *precondition* and an *effect* on the world state. |

The engine takes a high-level goal, recursively breaks it down through Methods, and returns a **flat, chronologically ordered array of Operators** ready for execution.

---

## The Dopamine Moment 🚀

You type a single two-word command into your terminal, hit Enter, and watch the engine **explode** that command into a deeply nested tree of perfectly ordered, executable micro-tasks:

```
Goal: "FetchCoffee"

FetchCoffee
 └─ StandardFetch
     ├─ MoveToKitchen   ← Operator
     ├─ PourCoffee      ← Operator
     └─ ReturnToStart   ← Operator

Flat execution plan → [MoveToKitchen, PourCoffee, ReturnToStart]
```

---

## Use Cases

### 🤖 Robotics

```
Goal: "FetchCoffee"

FetchCoffee → [GoToKitchen, PourCoffee, ReturnToStart]
GoToKitchen → [TurnLeft, MoveForward5m, AvoidTable]
```

### 🧠 AI Agent

The **exact same engine**, different domain:

```
Goal: "WriteCode"

WriteCode  → [ResearchAPI, DraftCode, WriteTests]
ResearchAPI → [SearchGoogle, ReadDocs, Summarize]
```

One engine. Any domain. Zero coupling to the real world.

### 🧠 LLM Orchestration (Neuro-Symbolic AI)

LLMs are great at reasoning but terrible at long-term rigid planning. Use the LLM to translate natural language into your HTN state, and use `htn-plan` to strictly orchestrate the LLM's tool calls without hallucinations.

```
User: "Research quantum computing and write a summary"

LLM translates → HTN state: { topic: "quantum computing", hasSummary: false }
HTN plan       → [SearchWeb, ReadSources, ExtractKeyPoints, WriteSummary]

Every tool call is gated by a precondition — no hallucinated steps, no skipped actions.
```

---

## Installation

```bash
npm install htn-plan
```

---

## Quick Start

```typescript
import { createPlanner } from 'htn-plan';
import type { Domain } from 'htn-plan';

// 1. Define your world state shape
interface RobotState {
  location: string;
  hasItem: boolean;
  batteryLevel: number;
}

// 2. Build your domain (operators + compound tasks)
const domain: Domain<RobotState> = {
  operators: {
    MoveToKitchen: {
      name: 'MoveToKitchen',
      condition: (s) => s.batteryLevel > 0 && s.location !== 'Kitchen',
      effect:    (s) => ({ ...s, location: 'Kitchen' }),
    },
    PourCoffee: {
      name: 'PourCoffee',
      condition: (s) => s.location === 'Kitchen' && !s.hasItem,
      effect:    (s) => ({ ...s, hasItem: true }),
    },
    ReturnToStart: {
      name: 'ReturnToStart',
      condition: (s) => s.hasItem,
      effect:    (s) => ({ ...s, location: 'Start' }),
    },
  },
  compoundTasks: {
    FetchCoffee: {
      name: 'FetchCoffee',
      methods: [
        {
          name: 'StandardFetch',
          condition: (_s) => true,
          subtasks: ['MoveToKitchen', 'PourCoffee', 'ReturnToStart'],
        },
      ],
    },
  },
};

// 3. Create a planner and run it
const result = createPlanner({
  domain,
  initialState: { location: 'Hall', hasItem: false, batteryLevel: 100 },
  goals: ['FetchCoffee'],
}).plan();

// 4. Inspect the result
if (result.success) {
  result.plan.forEach((op) => console.log(op.name));
  // → MoveToKitchen
  // → PourCoffee
  // → ReturnToStart
} else {
  console.error(result.reason, result.failedTask);
}
```

---

## Core API

### `createPlanner(config)`

Creates a planner instance and returns an object with a single `plan()` method.

| Parameter | Type | Description |
|---|---|---|
| `config.domain` | `Domain<TState>` | All operators and compound tasks available to the planner. |
| `config.initialState` | `TState` | The world state before planning begins. Never mutated. |
| `config.goals` | `ReadonlyArray<string>` | Top-level task names to achieve, resolved left-to-right. |

**Returns** `PlanningResult<TState>` — a discriminated union:

```typescript
// Success
{ success: true;  plan: ReadonlyArray<Operator<TState>> }

// Failure
{ success: false; reason: PlanningFailureReason; failedTask: string }
```

Failure reasons: `"UNKNOWN_TASK"` | `"OPERATOR_PRECONDITION_FAILED"` | `"NO_APPLICABLE_METHOD"`

---

### `Domain<TState>` — Fluent Builder

Instead of constructing the plain `Domain` object literal shown in Quick Start, you can use the `Domain` class for a chainable, incremental registration API:

```typescript
import { Domain, createPlanner } from 'htn-plan';

const domain = new Domain<RobotState>()
  .registerOperator({
    name: 'MoveToKitchen',
    condition: (s) => s.batteryLevel > 0 && s.location !== 'Kitchen',
    effect:    (s) => ({ ...s, location: 'Kitchen' }),
  })
  .registerOperator({
    name: 'PourCoffee',
    condition: (s) => s.location === 'Kitchen' && !s.hasItem,
    effect:    (s) => ({ ...s, hasItem: true }),
  })
  .registerOperator({
    name: 'ReturnToStart',
    condition: (s) => s.hasItem,
    effect:    (s) => ({ ...s, location: 'Start' }),
  })
  .registerMethod('FetchCoffee', {
    name: 'StandardFetch',
    condition: () => true,
    subtasks: ['MoveToKitchen', 'PourCoffee', 'ReturnToStart'],
  });

// Pass the Domain instance directly — it implements the Domain<TState> interface
const result = createPlanner({
  domain,
  initialState: { location: 'Hall', hasItem: false, batteryLevel: 100 },
  goals: ['FetchCoffee'],
}).plan();
```

| Method | Returns | Description |
|---|---|---|
| `.registerOperator(operator)` | `this` | Adds (or overwrites) a primitive task. |
| `.registerMethod(taskName, method)` | `this` | Appends a decomposition method to a compound task (created on first use). |

---

### Type Reference (`src/types.ts`)

```typescript
// World state — any plain object you define
type State<TState> = TState;

// Directly executable action
interface Operator<TState> {
  readonly name: string;
  condition: (state: TState) => boolean;   // precondition check
  effect:    (state: TState) => TState;    // must return a NEW state (no mutation)
}

// One decomposition recipe for a compound task
interface Method<TState> {
  readonly name: string;
  condition: (state: TState) => boolean;   // when is this decomposition valid?
  subtasks:  ReadonlyArray<string>;        // ordered list of sub-task names
}

// An abstract goal with one or more methods
interface CompoundTask<TState> {
  readonly name: string;
  methods: ReadonlyArray<Method<TState>>;  // tried in order; first valid wins
}

// The complete problem description passed to createPlanner()
interface Domain<TState> {
  operators:     Record<string, Operator<TState>>;
  compoundTasks: Record<string, CompoundTask<TState>>;
}
```

---

## How the Planner Works

The engine implements a **Depth-First Search (DFS) with backtracking**:

1. Take the first task from the queue.
2. If it is an **Operator**: check its precondition against the current simulated state. If it passes, apply the effect, add the operator to the plan, and continue with the remaining tasks.
3. If it is a **Compound Task**: iterate through its methods in order. For each method whose condition passes, inline its `subtasks` at the front of the queue and recurse.
4. If a branch leads to a dead-end (precondition fails deep in the tree), **backtrack** and try the next method.
5. Return the first complete plan found, or a failure descriptor when all branches are exhausted.

State is **never mutated** — each recursive call receives a fresh copy of the world state.

---

## Project Structure

```
htn-plan/
├── src/
│   ├── types.ts        # All TypeScript type definitions (blueprints)
│   ├── planner.ts      # HTN solver (DFS + backtracking)
│   ├── index.ts        # Public API re-exports
│   └── __tests__/
│       ├── types.test.ts    # Compile-time type checks
│       └── planner.test.ts  # Runtime behaviour & backtracking tests
├── jest.config.js
├── tsconfig.json
└── package.json
```

---

## Development

### Install dependencies

```bash
npm install
```

### Run tests (TDD)

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Type-check without emitting

```bash
npm run lint
```

### Build

```bash
npm run build
```

---

## Design Principles

- **Pure TypeScript** — no runtime dependencies, fully typed generics.
- **Immutable state** — operators must return a new state; the planner never mutates the state you pass in.
- **Domain-agnostic** — the engine knows nothing about the real world. You wire it up through a `Domain` object.
- **TDD-first** — the type definitions and solver were written test-first; all edge cases (backtracking, empty goals, unknown tasks) are covered by the test suite.

---

## License

MIT © franruedaesq