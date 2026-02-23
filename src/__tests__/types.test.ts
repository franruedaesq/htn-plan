/**
 * Compile-time type checks for src/types.ts.
 * These tests verify that the generic type definitions are usable and
 * that TypeScript correctly infers / enforces the expected shapes.
 */

import type {
  Operator,
  Method,
  CompoundTask,
  Domain,
  PlannerConfig,
  PlanningResult,
  PlanningSuccess,
  PlanningFailure,
} from "../types";

// ── Domain-specific state for tests ─────────────────────────────────────────

interface RobotState {
  location: string;
  hasItem: boolean;
  batteryLevel: number;
}

// ── Operator ─────────────────────────────────────────────────────────────────

describe("Operator<TState> type", () => {
  it("allows constructing a valid Operator with typed state", () => {
    const moveOperator: Operator<RobotState> = {
      name: "Move",
      condition: (state) => state.batteryLevel > 0,
      effect: (state) => ({ ...state, location: "Kitchen" }),
    };

    expect(moveOperator.name).toBe("Move");
    expect(moveOperator.condition({ location: "Hall", hasItem: false, batteryLevel: 10 })).toBe(true);
    expect(moveOperator.condition({ location: "Hall", hasItem: false, batteryLevel: 0 })).toBe(false);

    const next = moveOperator.effect({ location: "Hall", hasItem: false, batteryLevel: 10 });
    expect(next.location).toBe("Kitchen");
    // Effect must not mutate the original (tested at runtime level).
    const original: RobotState = { location: "Hall", hasItem: false, batteryLevel: 10 };
    moveOperator.effect(original);
    expect(original.location).toBe("Hall");
  });

  it("condition returns false correctly", () => {
    const op: Operator<RobotState> = {
      name: "Grab",
      condition: (s) => !s.hasItem,
      effect: (s) => ({ ...s, hasItem: true }),
    };

    expect(op.condition({ location: "A", hasItem: true, batteryLevel: 5 })).toBe(false);
    expect(op.condition({ location: "A", hasItem: false, batteryLevel: 5 })).toBe(true);
  });
});

// ── Method ───────────────────────────────────────────────────────────────────

describe("Method<TState> type", () => {
  it("allows constructing a valid Method with typed state and subtask list", () => {
    const walkMethod: Method<RobotState> = {
      name: "WalkToKitchen",
      condition: (s) => s.batteryLevel > 0,
      subtasks: ["TurnLeft", "MoveForward"],
    };

    expect(walkMethod.name).toBe("WalkToKitchen");
    expect(walkMethod.subtasks).toHaveLength(2);
    expect(walkMethod.subtasks[0]).toBe("TurnLeft");
    expect(walkMethod.condition({ location: "Hall", hasItem: false, batteryLevel: 5 })).toBe(true);
  });
});

// ── CompoundTask ─────────────────────────────────────────────────────────────

describe("CompoundTask<TState> type", () => {
  it("groups multiple methods under one compound task", () => {
    const travelTask: CompoundTask<RobotState> = {
      name: "Travel",
      methods: [
        {
          name: "TravelByWheels",
          condition: (s) => s.batteryLevel >= 10,
          subtasks: ["DriveForward"],
        },
        {
          name: "TravelOnFoot",
          condition: (_s) => true,
          subtasks: ["Walk"],
        },
      ],
    };

    expect(travelTask.name).toBe("Travel");
    expect(travelTask.methods).toHaveLength(2);
    expect(travelTask.methods[0].name).toBe("TravelByWheels");
    expect(travelTask.methods[1].name).toBe("TravelOnFoot");
  });
});

// ── Domain ───────────────────────────────────────────────────────────────────

describe("Domain<TState> type", () => {
  it("holds both operators and compound tasks keyed by name", () => {
    const domain: Domain<RobotState> = {
      operators: {
        Walk: {
          name: "Walk",
          condition: (_s) => true,
          effect: (s) => ({ ...s, location: "Kitchen" }),
        },
      },
      compoundTasks: {
        GoToKitchen: {
          name: "GoToKitchen",
          methods: [
            {
              name: "DirectWalk",
              condition: (_s) => true,
              subtasks: ["Walk"],
            },
          ],
        },
      },
    };

    expect(Object.keys(domain.operators)).toContain("Walk");
    expect(Object.keys(domain.compoundTasks)).toContain("GoToKitchen");
  });
});

// ── PlannerConfig ─────────────────────────────────────────────────────────────

describe("PlannerConfig<TState> type", () => {
  it("bundles domain, initialState and goals together", () => {
    const initialState: RobotState = { location: "Start", hasItem: false, batteryLevel: 100 };

    const config: PlannerConfig<RobotState> = {
      domain: { operators: {}, compoundTasks: {} },
      initialState,
      goals: ["GoToKitchen"],
    };

    expect(config.goals).toContain("GoToKitchen");
    expect(config.initialState).toBe(initialState);
  });
});

// ── PlanningResult discriminated union ───────────────────────────────────────

describe("PlanningResult<TState> discriminated union", () => {
  it("narrows correctly to PlanningSuccess", () => {
    const success: PlanningResult<RobotState> = {
      success: true,
      plan: [],
    };

    if (success.success) {
      const typed: PlanningSuccess<RobotState> = success;
      expect(typed.plan).toBeDefined();
    }
    expect(success.success).toBe(true);
  });

  it("narrows correctly to PlanningFailure", () => {
    const failure: PlanningResult<RobotState> = {
      success: false,
      reason: "NO_APPLICABLE_METHOD",
      failedTask: "Travel",
    };

    if (!failure.success) {
      const typed: PlanningFailure = failure;
      expect(typed.reason).toBe("NO_APPLICABLE_METHOD");
      expect(typed.failedTask).toBe("Travel");
    }
  });
});
