import { Domain } from "../domain";
import { createPlanner } from "../planner";
import type { Operator, Method } from "../types";

// ── Domain-specific state for tests ─────────────────────────────────────────

interface RobotState {
  location: string;
  hasItem: boolean;
  batteryLevel: number;
}

// ── Helper fixtures ───────────────────────────────────────────────────────────

const moveOp: Operator<RobotState> = {
  name: "Move",
  condition: (s) => s.batteryLevel > 0,
  effect: (s) => ({ ...s, location: "Kitchen" }),
};

const grabOp: Operator<RobotState> = {
  name: "Grab",
  condition: (s) => !s.hasItem,
  effect: (s) => ({ ...s, hasItem: true }),
};

const walkMethod: Method<RobotState> = {
  name: "WalkToKitchen",
  condition: (s) => s.batteryLevel > 0,
  subtasks: ["Move"],
};

const rollMethod: Method<RobotState> = {
  name: "RollToKitchen",
  condition: (_s) => true,
  subtasks: ["Move"],
};

// ── registerOperator ─────────────────────────────────────────────────────────

describe("Domain – registerOperator", () => {
  it("stores an operator and makes it retrievable by name", () => {
    const domain = new Domain<RobotState>();
    domain.registerOperator(moveOp);

    expect(domain.getOperator("Move")).toBe(moveOp);
  });

  it("returns `this` for fluent chaining", () => {
    const domain = new Domain<RobotState>();
    const result = domain.registerOperator(moveOp);

    expect(result).toBe(domain);
  });

  it("stores multiple operators independently", () => {
    const domain = new Domain<RobotState>()
      .registerOperator(moveOp)
      .registerOperator(grabOp);

    expect(domain.getOperator("Move")).toBe(moveOp);
    expect(domain.getOperator("Grab")).toBe(grabOp);
  });

  it("overwrites an operator registered under the same name", () => {
    const updated: Operator<RobotState> = { ...moveOp, name: "Move" };
    const domain = new Domain<RobotState>()
      .registerOperator(moveOp)
      .registerOperator(updated);

    expect(domain.getOperator("Move")).toBe(updated);
  });

  it("exposes the operator in the `operators` record", () => {
    const domain = new Domain<RobotState>().registerOperator(moveOp);

    expect(Object.keys(domain.operators)).toContain("Move");
    expect(domain.operators["Move"]).toBe(moveOp);
  });
});

// ── getOperator ───────────────────────────────────────────────────────────────

describe("Domain – getOperator", () => {
  it("returns undefined for an unknown operator name", () => {
    const domain = new Domain<RobotState>();

    expect(domain.getOperator("NonExistent")).toBeUndefined();
  });
});

// ── registerMethod ────────────────────────────────────────────────────────────

describe("Domain – registerMethod", () => {
  it("creates a compound task on first registration", () => {
    const domain = new Domain<RobotState>().registerMethod("Travel", walkMethod);

    expect(domain.compoundTasks["Travel"]).toBeDefined();
    expect(domain.compoundTasks["Travel"].name).toBe("Travel");
  });

  it("appends methods in registration order", () => {
    const domain = new Domain<RobotState>()
      .registerMethod("Travel", walkMethod)
      .registerMethod("Travel", rollMethod);

    const { methods } = domain.compoundTasks["Travel"];
    expect(methods).toHaveLength(2);
    expect(methods[0]).toBe(walkMethod);
    expect(methods[1]).toBe(rollMethod);
  });

  it("returns `this` for fluent chaining", () => {
    const domain = new Domain<RobotState>();
    const result = domain.registerMethod("Travel", walkMethod);

    expect(result).toBe(domain);
  });

  it("creates independent compound tasks for different task names", () => {
    const method2: Method<RobotState> = {
      name: "DirectGrab",
      condition: (_s) => true,
      subtasks: ["Grab"],
    };

    const domain = new Domain<RobotState>()
      .registerMethod("Travel", walkMethod)
      .registerMethod("PickUp", method2);

    expect(Object.keys(domain.compoundTasks)).toEqual(
      expect.arrayContaining(["Travel", "PickUp"])
    );
    expect(domain.compoundTasks["Travel"].methods).toHaveLength(1);
    expect(domain.compoundTasks["PickUp"].methods).toHaveLength(1);
  });
});

// ── getMethod ─────────────────────────────────────────────────────────────────

describe("Domain – getMethod", () => {
  it("retrieves a method by its name", () => {
    const domain = new Domain<RobotState>().registerMethod("Travel", walkMethod);

    expect(domain.getMethod("WalkToKitchen")).toBe(walkMethod);
  });

  it("retrieves a method even when it belongs to a second compound task", () => {
    const domain = new Domain<RobotState>()
      .registerMethod("Travel", walkMethod)
      .registerMethod("Travel", rollMethod);

    expect(domain.getMethod("RollToKitchen")).toBe(rollMethod);
  });

  it("returns undefined for an unknown method name", () => {
    const domain = new Domain<RobotState>().registerMethod("Travel", walkMethod);

    expect(domain.getMethod("NonExistent")).toBeUndefined();
  });

  it("returns undefined on an empty domain", () => {
    const domain = new Domain<RobotState>();

    expect(domain.getMethod("Anything")).toBeUndefined();
  });
});

// ── IDomain interface compatibility (used with createPlanner) ─────────────────

describe("Domain – IDomain interface compatibility", () => {
  it("can be passed directly to createPlanner as a domain", () => {
    const domain = new Domain<RobotState>()
      .registerOperator(moveOp)
      .registerOperator(grabOp)
      .registerMethod("FetchItem", {
        name: "StandardFetch",
        condition: (_s) => true,
        subtasks: ["Move", "Grab"],
      });

    const result = createPlanner({
      domain,
      initialState: { location: "Hall", hasItem: false, batteryLevel: 100 },
      goals: ["FetchItem"],
    }).plan();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.map((o) => o.name)).toEqual(["Move", "Grab"]);
  });
});
