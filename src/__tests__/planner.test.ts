import { createPlanner } from "../planner";
import type { Domain, Operator } from "../types";

// ── Shared domain types ──────────────────────────────────────────────────────

interface RobotState {
  location: string;
  hasItem: boolean;
  batteryLevel: number;
}

// ── Helper builders ───────────────────────────────────────────────────────────

function makeRobotDomain(): Domain<RobotState> {
  return {
    operators: {
      MoveToKitchen: {
        name: "MoveToKitchen",
        condition: (s) => s.batteryLevel > 0 && s.location !== "Kitchen",
        effect: (s) => ({ ...s, location: "Kitchen" }),
      },
      PourCoffee: {
        name: "PourCoffee",
        condition: (s) => s.location === "Kitchen" && !s.hasItem,
        effect: (s) => ({ ...s, hasItem: true }),
      },
      ReturnToStart: {
        name: "ReturnToStart",
        condition: (s) => s.hasItem,
        effect: (s) => ({ ...s, location: "Start" }),
      },
    },
    compoundTasks: {
      FetchCoffee: {
        name: "FetchCoffee",
        methods: [
          {
            name: "StandardFetch",
            condition: (_s) => true,
            subtasks: ["MoveToKitchen", "PourCoffee", "ReturnToStart"],
          },
        ],
      },
    },
  };
}

// ── Basic planning ────────────────────────────────────────────────────────────

describe("createPlanner – basic", () => {
  it("returns a flat plan for a single primitive task", () => {
    const domain = makeRobotDomain();
    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0].name).toBe("MoveToKitchen");
  });

  it("returns a flat plan for a compound task", () => {
    const domain = makeRobotDomain();
    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.map((o) => o.name)).toEqual([
      "MoveToKitchen",
      "PourCoffee",
      "ReturnToStart",
    ]);
  });

  it("returns a plan for multiple top-level goals", () => {
    const domain = makeRobotDomain();
    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen", "PourCoffee", "ReturnToStart"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan).toHaveLength(3);
  });
});

// ── State simulation (effects applied to intermediate state) ─────────────────

describe("createPlanner – state simulation", () => {
  it("applies operator effects so subsequent preconditions can evaluate correctly", () => {
    // PourCoffee requires location === Kitchen.
    // MoveToKitchen sets location to Kitchen.
    // If simulation does NOT apply effects, PourCoffee precondition will fail.
    const domain = makeRobotDomain();
    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen", "PourCoffee"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan).toHaveLength(2);
  });

  it("does not mutate the provided initial state", () => {
    const domain = makeRobotDomain();
    const initialState: RobotState = { location: "Hall", hasItem: false, batteryLevel: 100 };

    createPlanner({
      domain,
      initialState,
      goals: ["FetchCoffee"],
    }).plan();

    expect(initialState.location).toBe("Hall");
    expect(initialState.hasItem).toBe(false);
  });
});

// ── First-valid-method selection ─────────────────────────────────────────────

describe("createPlanner – first-valid-method", () => {
  interface TravelState {
    hasCar: boolean;
    location: string;
  }

  const travelDomain: Domain<TravelState> = {
    operators: {
      Drive: {
        name: "Drive",
        condition: (s) => s.hasCar,
        effect: (s) => ({ ...s, location: "Destination" }),
      },
      Walk: {
        name: "Walk",
        condition: (_s) => true,
        effect: (s) => ({ ...s, location: "Destination" }),
      },
    },
    compoundTasks: {
      Travel: {
        name: "Travel",
        methods: [
          {
            name: "TravelByCar",
            condition: (s) => s.hasCar,
            subtasks: ["Drive"],
          },
          {
            name: "TravelByFoot",
            condition: (_s) => true,
            subtasks: ["Walk"],
          },
        ],
      },
    },
  };

  it("picks the first applicable method (TravelByCar) when hasCar is true", () => {
    const result = createPlanner({
      domain: travelDomain,
      initialState: { hasCar: true, location: "Start" },
      goals: ["Travel"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan[0].name).toBe("Drive");
  });

  it("falls back to TravelByFoot when hasCar is false", () => {
    const result = createPlanner({
      domain: travelDomain,
      initialState: { hasCar: false, location: "Start" },
      goals: ["Travel"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan[0].name).toBe("Walk");
  });
});

// ── Backtracking ──────────────────────────────────────────────────────────────

describe("createPlanner – backtracking", () => {
  /**
   * Domain that forces the planner to backtrack:
   *
   * GetFuel  → compound with two methods:
   *   "FastRefuel"  : requires !outOfGas → sets gas=true  [works]
   *   "SlowRefuel"  : always applicable  → sets gas=true  [fallback]
   *
   * Drive    : requires gas=true
   *
   * Goal: ["GetFuel", "Drive"]
   *
   * We engineer a case where the first method of GetFuel would work BUT
   * we flip it so the first method *doesn't apply* — forcing the fallback.
   */
  interface CarState {
    gas: boolean;
    driven: boolean;
  }

  const carDomain: Domain<CarState> = {
    operators: {
      FastRefuel: {
        name: "FastRefuel",
        condition: (s) => !s.gas, // Only makes sense when no gas
        effect: (s) => ({ ...s, gas: true }),
      },
      SlowRefuel: {
        name: "SlowRefuel",
        condition: (_s) => true,
        effect: (s) => ({ ...s, gas: true }),
      },
      Drive: {
        name: "Drive",
        condition: (s) => s.gas,
        effect: (s) => ({ ...s, driven: true }),
      },
    },
    compoundTasks: {
      GetFuel: {
        name: "GetFuel",
        methods: [
          {
            // This method's subtask will FAIL its own precondition when gas is already true,
            // so if initial state already has gas=true it backtracks to SlowRefuel.
            name: "FastMethod",
            condition: (s) => !s.gas, // Not applicable when gas=true
            subtasks: ["FastRefuel"],
          },
          {
            name: "SlowMethod",
            condition: (_s) => true,
            subtasks: ["SlowRefuel"],
          },
        ],
      },
    },
  };

  it("uses FastRefuel when gas is false (first method applies)", () => {
    const result = createPlanner({
      domain: carDomain,
      initialState: { gas: false, driven: false },
      goals: ["GetFuel", "Drive"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.map((o) => o.name)).toEqual(["FastRefuel", "Drive"]);
  });

  it("backtracks and uses SlowRefuel when first method is inapplicable", () => {
    // gas=true → FastMethod condition is false → falls back to SlowMethod
    const result = createPlanner({
      domain: carDomain,
      initialState: { gas: true, driven: false },
      goals: ["GetFuel", "Drive"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.map((o) => o.name)).toEqual(["SlowRefuel", "Drive"]);
  });

  it("backtracks correctly when a method's subtask fails a precondition mid-plan", () => {
    /**
     * Scenario:
     * Method A expands to [OpA1, OpA2] but OpA2 precondition fails after OpA1 effect.
     * Method B expands to [OpB] which always works.
     */
    interface SimpleState { counter: number }

    const deepBacktrackDomain: Domain<SimpleState> = {
      operators: {
        OpA1: {
          name: "OpA1",
          condition: (_s) => true,
          effect: (s) => ({ counter: s.counter + 10 }),
        },
        OpA2: {
          name: "OpA2",
          condition: (s) => s.counter < 5, // Will fail after OpA1 raises counter to 10
          effect: (s) => ({ counter: s.counter + 1 }),
        },
        OpB: {
          name: "OpB",
          condition: (_s) => true,
          effect: (s) => ({ counter: s.counter + 1 }),
        },
      },
      compoundTasks: {
        DoSomething: {
          name: "DoSomething",
          methods: [
            {
              name: "MethodA",
              condition: (_s) => true,
              subtasks: ["OpA1", "OpA2"],
            },
            {
              name: "MethodB",
              condition: (_s) => true,
              subtasks: ["OpB"],
            },
          ],
        },
      },
    };

    const result = createPlanner({
      domain: deepBacktrackDomain,
      initialState: { counter: 0 },
      goals: ["DoSomething"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Should have backtracked from MethodA (OpA2 precondition fails) to MethodB.
    expect(result.plan.map((o) => o.name)).toEqual(["OpB"]);
  });
});

// ── Failure cases ─────────────────────────────────────────────────────────────

describe("createPlanner – failure cases", () => {
  it("returns UNKNOWN_TASK when a goal name is not in the domain", () => {
    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["NonExistentTask"],
    }).plan();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("UNKNOWN_TASK");
    expect(result.failedTask).toBe("NonExistentTask");
  });

  it("returns OPERATOR_PRECONDITION_FAILED when the initial state doesn't satisfy the operator", () => {
    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 0 }, // battery dead
      goals: ["MoveToKitchen"],
    }).plan();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("OPERATOR_PRECONDITION_FAILED");
  });

  it("returns NO_APPLICABLE_METHOD when no method condition passes", () => {
    interface S { flag: boolean }
    const domain: Domain<S> = {
      operators: {},
      compoundTasks: {
        Task: {
          name: "Task",
          methods: [
            {
              name: "OnlyMethod",
              condition: (s) => s.flag, // Requires flag=true
              subtasks: [],
            },
          ],
        },
      },
    };

    const result = createPlanner({
      domain,
      initialState: { flag: false },
      goals: ["Task"],
    }).plan();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("NO_APPLICABLE_METHOD");
    expect(result.failedTask).toBe("Task");
  });

  it("returns success with an empty plan when goals list is empty", () => {
    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: [],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan).toHaveLength(0);
  });
});

// ── Output immutability ───────────────────────────────────────────────────────

describe("createPlanner – output immutability", () => {
  it("returns Operator objects from the domain (not copies)", () => {
    const domain = makeRobotDomain();
    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    const op: Operator<RobotState> = result.plan[0];
    expect(op).toBe(domain.operators["MoveToKitchen"]);
  });
});
