import { createPlanner } from "../planner";
import { Domain } from "../domain";
import { DomainValidationError, PlannerMaxDepthError } from "../errors";
import type { Domain as IDomain, PlannerHooks } from "../types";

// ── Shared state type ────────────────────────────────────────────────────────

interface RobotState {
  location: string;
  hasItem: boolean;
  batteryLevel: number;
}

function makeRobotDomain(): IDomain<RobotState> {
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

// ── PlannerHooks – onTaskExpand ───────────────────────────────────────────────

describe("PlannerHooks – onTaskExpand", () => {
  it("is called for every task the planner processes", () => {
    const expanded: Array<{ name: string; depth: number }> = [];
    const hooks: PlannerHooks<RobotState> = {
      onTaskExpand: (name, depth) => expanded.push({ name, depth }),
    };

    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
      hooks,
    }).plan();

    expect(result.success).toBe(true);
    // FetchCoffee (compound) + MoveToKitchen + PourCoffee + ReturnToStart
    const names = expanded.map((e) => e.name);
    expect(names).toContain("FetchCoffee");
    expect(names).toContain("MoveToKitchen");
    expect(names).toContain("PourCoffee");
    expect(names).toContain("ReturnToStart");
  });

  it("passes depth 0 for top-level goals", () => {
    const expanded: number[] = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen"],
      hooks: { onTaskExpand: (_name, depth) => expanded.push(depth) },
    }).plan();

    expect(expanded[0]).toBe(0);
  });
});

// ── PlannerHooks – onMethodTry ────────────────────────────────────────────────

describe("PlannerHooks – onMethodTry", () => {
  it("is called when a method is tried", () => {
    const tried: Array<{ task: string; method: string }> = [];
    const hooks: PlannerHooks<RobotState> = {
      onMethodTry: (task, method) => tried.push({ task, method }),
    };

    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
      hooks,
    }).plan();

    expect(tried).toContainEqual({ task: "FetchCoffee", method: "StandardFetch" });
  });

  it("is not called for primitive tasks (operators)", () => {
    const tried: string[] = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen"],
      hooks: { onMethodTry: (task) => tried.push(task) },
    }).plan();

    expect(tried).toHaveLength(0);
  });
});

// ── PlannerHooks – onBacktrack ────────────────────────────────────────────────

describe("PlannerHooks – onBacktrack", () => {
  it("is called when a method leads to a dead-end and the planner backtracks", () => {
    interface SimpleState { counter: number }

    const backtracked: Array<{ task: string; method: string }> = [];

    const domain: IDomain<SimpleState> = {
      operators: {
        OpA1: { name: "OpA1", condition: (_s) => true, effect: (s) => ({ counter: s.counter + 10 }) },
        OpA2: { name: "OpA2", condition: (s) => s.counter < 5, effect: (s) => ({ counter: s.counter + 1 }) },
        OpB: { name: "OpB", condition: (_s) => true, effect: (s) => ({ counter: s.counter + 1 }) },
      },
      compoundTasks: {
        DoSomething: {
          name: "DoSomething",
          methods: [
            { name: "MethodA", condition: (_s) => true, subtasks: ["OpA1", "OpA2"] },
            { name: "MethodB", condition: (_s) => true, subtasks: ["OpB"] },
          ],
        },
      },
    };

    const result = createPlanner({
      domain,
      initialState: { counter: 0 },
      goals: ["DoSomething"],
      hooks: { onBacktrack: (task, method) => backtracked.push({ task, method }) },
    }).plan();

    expect(result.success).toBe(true);
    expect(backtracked).toContainEqual({ task: "DoSomething", method: "MethodA" });
  });

  it("is not called on a successful first-try plan", () => {
    const backtracked: string[] = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
      hooks: { onBacktrack: (task) => backtracked.push(task) },
    }).plan();

    expect(backtracked).toHaveLength(0);
  });
});

// ── PlannerHooks – onOperatorApply ────────────────────────────────────────────

describe("PlannerHooks – onOperatorApply", () => {
  it("is called with the correct operator name", () => {
    const applied: string[] = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
      hooks: { onOperatorApply: (name) => applied.push(name) },
    }).plan();

    expect(applied).toEqual(["MoveToKitchen", "PourCoffee", "ReturnToStart"]);
  });

  it("provides correct stateBefore and stateAfter to the callback", () => {
    const snapshots: Array<{ before: RobotState; after: RobotState }> = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["MoveToKitchen"],
      hooks: {
        onOperatorApply: (_name, before, after) => {
          snapshots.push({ before: before as RobotState, after: after as RobotState });
        },
      },
    }).plan();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].before.location).toBe("Hall");
    expect(snapshots[0].after.location).toBe("Kitchen");
  });

  it("is not called when no operators are applied (empty plan)", () => {
    const applied: string[] = [];
    createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: [],
      hooks: { onOperatorApply: (name) => applied.push(name) },
    }).plan();

    expect(applied).toHaveLength(0);
  });
});

// ── PlannerHooks – no hooks provided ─────────────────────────────────────────

describe("PlannerHooks – optional (no hooks provided)", () => {
  it("runs successfully when hooks is omitted entirely", () => {
    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
    }).plan();

    expect(result.success).toBe(true);
  });

  it("runs successfully when hooks is an empty object", () => {
    const result = createPlanner({
      domain: makeRobotDomain(),
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchCoffee"],
      hooks: {},
    }).plan();

    expect(result.success).toBe(true);
  });
});

// ── Domain.validate() ─────────────────────────────────────────────────────────

describe("Domain.validate()", () => {
  it("returns `this` for fluent chaining on a valid domain", () => {
    const domain = new Domain<RobotState>()
      .registerOperator({
        name: "Move",
        condition: (s) => s.batteryLevel > 0,
        effect: (s) => ({ ...s, location: "Kitchen" }),
      })
      .registerMethod("Fetch", {
        name: "StandardFetch",
        condition: () => true,
        subtasks: ["Move"],
      });

    expect(domain.validate()).toBe(domain);
  });

  it("does not throw when all subtasks are registered operators", () => {
    const domain = new Domain<RobotState>()
      .registerOperator({
        name: "Move",
        condition: (s) => s.batteryLevel > 0,
        effect: (s) => ({ ...s, location: "Kitchen" }),
      })
      .registerMethod("Fetch", {
        name: "StandardFetch",
        condition: () => true,
        subtasks: ["Move"],
      });

    expect(() => domain.validate()).not.toThrow();
  });

  it("does not throw when a subtask resolves to a compound task", () => {
    const domain = new Domain<RobotState>()
      .registerOperator({
        name: "Move",
        condition: () => true,
        effect: (s) => s,
      })
      .registerMethod("SubTask", {
        name: "SubMethod",
        condition: () => true,
        subtasks: ["Move"],
      })
      .registerMethod("TopLevel", {
        name: "TopMethod",
        condition: () => true,
        subtasks: ["SubTask"],
      });

    expect(() => domain.validate()).not.toThrow();
  });

  it("throws DomainValidationError when a subtask is not registered", () => {
    const domain = new Domain<RobotState>().registerMethod("Fetch", {
      name: "BrokenMethod",
      condition: () => true,
      subtasks: ["NonExistentTask"],
    });

    expect(() => domain.validate()).toThrow(DomainValidationError);
  });

  it("sets unresolvedTask on the thrown error", () => {
    const domain = new Domain<RobotState>().registerMethod("Fetch", {
      name: "BrokenMethod",
      condition: () => true,
      subtasks: ["MissingOp"],
    });

    let caught: DomainValidationError | undefined;
    try {
      domain.validate();
    } catch (err) {
      caught = err as DomainValidationError;
    }

    expect(caught).toBeInstanceOf(DomainValidationError);
    expect(caught?.unresolvedTask).toBe("MissingOp");
  });

  it("passes on an empty domain (no operators or methods)", () => {
    const domain = new Domain<RobotState>();
    expect(() => domain.validate()).not.toThrow();
  });
});

// ── Error classes – exported from errors.ts ───────────────────────────────────

describe("PlannerMaxDepthError", () => {
  it("has the correct name property", () => {
    const err = new PlannerMaxDepthError();
    expect(err.name).toBe("PlannerMaxDepthError");
  });

  it("is an instance of Error", () => {
    expect(new PlannerMaxDepthError()).toBeInstanceOf(Error);
  });

  it("includes the depth in the message", () => {
    const err = new PlannerMaxDepthError(42);
    expect(err.message).toContain("42");
  });
});

describe("DomainValidationError", () => {
  it("has the correct name property", () => {
    const err = new DomainValidationError("MissingTask");
    expect(err.name).toBe("DomainValidationError");
  });

  it("is an instance of Error", () => {
    expect(new DomainValidationError("X")).toBeInstanceOf(Error);
  });

  it("exposes unresolvedTask", () => {
    const err = new DomainValidationError("TaskX");
    expect(err.unresolvedTask).toBe("TaskX");
  });

  it("includes the task name in the message", () => {
    const err = new DomainValidationError("MissingTask");
    expect(err.message).toContain("MissingTask");
  });
});
