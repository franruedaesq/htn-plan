import type {
  Domain,
  Operator,
  PlannerConfig,
  PlanningResult,
} from "./types";

/** Maximum recursion depth allowed before the planner aborts with an error. */
const MAX_RECURSION_DEPTH = 1000;

/**
 * Thrown when the HTN planner exceeds {@link MAX_RECURSION_DEPTH} recursive
 * calls, which typically indicates a cyclic task decomposition (infinite loop).
 */
export class PlannerMaxDepthError extends Error {
  constructor() {
    super(
      `HTN planner exceeded the maximum recursion depth of ${MAX_RECURSION_DEPTH}. ` +
        "This usually indicates a cyclic task decomposition."
    );
    this.name = "PlannerMaxDepthError";
  }
}

/**
 * Internal recursive DFS solver with backtracking.
 *
 * @param tasks   Remaining task names to process.
 * @param state   Current simulated world state.
 * @param domain  Full domain description.
 * @param plan    Operators accumulated so far (mutated in place, rewound on backtrack).
 * @param depth   Current recursion depth (used for infinite-loop protection).
 * @returns       The completed flat plan on success, or null when no plan exists.
 */
function solve<TState>(
  tasks: string[],
  state: TState,
  domain: Domain<TState>,
  plan: Operator<TState>[],
  depth: number
): { plan: Operator<TState>[]; finalState: TState } | null {
  if (depth > MAX_RECURSION_DEPTH) {
    throw new PlannerMaxDepthError();
  }

  // Base case: no more tasks → plan is complete.
  if (tasks.length === 0) {
    return { plan: [...plan], finalState: state };
  }

  const [current, ...rest] = tasks;

  // ── Primitive task (Operator) ────────────────────────────────────────────
  if (current in domain.operators) {
    const operator = domain.operators[current];

    if (!operator.condition(state)) {
      // Precondition failed → backtrack immediately.
      return null;
    }

    const nextState = operator.effect(state);
    plan.push(operator);
    const result = solve(rest, nextState, domain, plan, depth + 1);
    if (result !== null) {
      return result;
    }
    // Rewind and signal failure upward.
    plan.pop();
    return null;
  }

  // ── Compound task ────────────────────────────────────────────────────────
  if (current in domain.compoundTasks) {
    const compound = domain.compoundTasks[current];

    for (const method of compound.methods) {
      if (!method.condition(state)) {
        continue; // Try next method.
      }

      // Inline the subtasks in front of the remaining tasks and recurse.
      const expanded = [...method.subtasks, ...rest];
      const result = solve(expanded, state, domain, plan, depth + 1);
      if (result !== null) {
        return result;
      }
      // This method led to a dead-end → try the next one (backtracking).
    }

    // All methods exhausted with no solution.
    return null;
  }

  // ── Unknown task ─────────────────────────────────────────────────────────
  return null;
}

/**
 * Creates a new HTN planner bound to a specific domain and initial state.
 *
 * @example
 * ```ts
 * const result = createPlanner({ domain, initialState, goals }).plan();
 * if (result.success) {
 *   result.plan.forEach(op => console.log(op.name));
 * }
 * ```
 */
export function createPlanner<TState>(config: PlannerConfig<TState>) {
  return {
    /**
     * Runs the HTN planning algorithm and returns either a flat ordered
     * execution plan or a failure descriptor.
     */
    plan(): PlanningResult<TState> {
      const { domain, initialState, goals } = config;

      // Validate that all goal tasks exist in the domain.
      for (const goal of goals) {
        const known =
          goal in domain.operators || goal in domain.compoundTasks;
        if (!known) {
          return {
            success: false,
            reason: "UNKNOWN_TASK",
            failedTask: goal,
          };
        }
      }

      const result = solve([...goals], initialState, domain, [], 0);

      if (result === null) {
        // Determine the best failure reason by inspecting goal tasks.
        // For a precise per-task reason we do a lightweight single-pass check.
        for (const goal of goals) {
          if (!(goal in domain.operators) && !(goal in domain.compoundTasks)) {
            return {
              success: false,
              reason: "UNKNOWN_TASK",
              failedTask: goal,
            };
          }
          if (goal in domain.operators) {
            const op = domain.operators[goal];
            if (!op.condition(initialState)) {
              return {
                success: false,
                reason: "OPERATOR_PRECONDITION_FAILED",
                failedTask: goal,
              };
            }
          }
          if (goal in domain.compoundTasks) {
            const compound = domain.compoundTasks[goal];
            const anyApplicable = compound.methods.some((m) =>
              m.condition(initialState)
            );
            if (!anyApplicable) {
              return {
                success: false,
                reason: "NO_APPLICABLE_METHOD",
                failedTask: goal,
              };
            }
          }
        }
        // Generic failure (e.g. a sub-task deep in the tree failed).
        return {
          success: false,
          reason: "NO_APPLICABLE_METHOD",
          failedTask: goals[0] ?? "(unknown)",
        };
      }

      return { success: true, plan: result.plan };
    },
  };
}

/**
 * HTN Planner class that resolves a task list against a domain using
 * Depth-First Search with backtracking.
 *
 * @template TState - The shape of the world state.
 *
 * @example
 * ```ts
 * const planner = new Planner<RobotState>();
 * const result = planner.resolve(initialState, domain, ["FetchCoffee"]);
 * if (result.success) {
 *   result.plan.forEach(op => console.log(op.name));
 * }
 * ```
 */
export class Planner<TState> {
  /**
   * Runs the HTN planning algorithm using Depth-First Search and backtracking.
   *
   * @param state   The initial world state before planning begins.
   * @param domain  The domain describing all available tasks.
   * @param tasks   Top-level goal task names (resolved left-to-right).
   * @returns       A {@link PlanningResult} with either a flat ordered plan or a failure descriptor.
   */
  resolve(
    state: TState,
    domain: Domain<TState>,
    tasks: string[]
  ): PlanningResult<TState> {
    return createPlanner({ domain, initialState: state, goals: tasks }).plan();
  }
}
