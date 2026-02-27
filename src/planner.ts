import type {
  Domain,
  Operator,
  PlannerConfig,
  PlannerHooks,
  PlanningResult,
} from "./types";
import { PlannerMaxDepthError } from "./errors";

export { PlannerMaxDepthError, DomainValidationError } from "./errors";

/** Maximum recursion depth allowed before the planner aborts with an error. */
const MAX_RECURSION_DEPTH = 1000;

/**
 * Returns true only when `key` is an **own** (non-inherited) property of
 * `obj`.  This guards every task-name lookup against prototype-pollution
 * attacks: names such as `"__proto__"`, `"constructor"`, or `"toString"`
 * exist on every plain-object prototype chain and would otherwise pass a
 * naïve `key in obj` check even when no such task has been registered.
 */
function hasOwnTask(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Walks every task reachable from `roots` via method subtask lists and
 * returns the name of the first task that is not registered in the domain,
 * or `null` when all reachable tasks are known.
 *
 * This pre-validation lets the planner report a precise `UNKNOWN_TASK`
 * failure even when the unknown task is buried deep inside a method's
 * subtask list, rather than only catching unknown top-level goals.
 */
function findFirstUnknownTask<TState>(
  roots: ReadonlyArray<string>,
  domain: Domain<TState>
): string | null {
  const visited = new Set<string>();
  const queue: string[] = [...roots];
  while (queue.length > 0) {
    const task = queue.shift()!;
    if (visited.has(task)) continue;
    visited.add(task);

    if (hasOwnTask(domain.operators as Record<string, unknown>, task)) continue;

    if (hasOwnTask(domain.compoundTasks as Record<string, unknown>, task)) {
      for (const method of domain.compoundTasks[task]!.methods) {
        for (const subtask of method.subtasks) {
          queue.push(subtask);
        }
      }
      continue;
    }

    return task; // Not found in operators or compoundTasks.
  }
  return null;
}

/**
 * Internal recursive DFS solver with backtracking.
 *
 * @param tasks   Remaining task names to process.
 * @param state   Current simulated world state.
 * @param domain  Full domain description.
 * @param plan    Operators accumulated so far (mutated in place, rewound on backtrack).
 * @param depth   Current recursion depth (used for infinite-loop protection).
 * @param hooks   Optional observability callbacks.
 * @returns       The completed flat plan on success, or null when no plan exists.
 */
function solve<TState>(
  tasks: string[],
  state: TState,
  domain: Domain<TState>,
  plan: Operator<TState>[],
  depth: number,
  hooks: PlannerHooks<TState> | undefined
): { plan: Operator<TState>[]; finalState: TState } | null {
  if (depth > MAX_RECURSION_DEPTH) {
    throw new PlannerMaxDepthError(MAX_RECURSION_DEPTH);
  }

  // Base case: no more tasks → plan is complete.
  if (tasks.length === 0) {
    return { plan: [...plan], finalState: state };
  }

  const [current, ...rest] = tasks;

  hooks?.onTaskExpand?.(current, depth);

  // ── Primitive task (Operator) ────────────────────────────────────────────
  if (hasOwnTask(domain.operators as Record<string, unknown>, current)) {
    const operator = domain.operators[current];

    if (!operator.condition(state)) {
      // Precondition failed → backtrack immediately.
      return null;
    }

    const nextState = operator.effect(state);
    hooks?.onOperatorApply?.(current, state, nextState);
    plan.push(operator);
    const result = solve(rest, nextState, domain, plan, depth + 1, hooks);
    if (result !== null) {
      return result;
    }
    // Rewind and signal failure upward.
    plan.pop();
    return null;
  }

  // ── Compound task ────────────────────────────────────────────────────────
  if (hasOwnTask(domain.compoundTasks as Record<string, unknown>, current)) {
    const compound = domain.compoundTasks[current];

    for (const method of compound.methods) {
      if (!method.condition(state)) {
        continue; // Try next method.
      }

      hooks?.onMethodTry?.(current, method.name, depth);

      // Inline the subtasks in front of the remaining tasks and recurse.
      const expanded = [...method.subtasks, ...rest];
      const result = solve(expanded, state, domain, plan, depth + 1, hooks);
      if (result !== null) {
        return result;
      }
      // This method led to a dead-end → try the next one (backtracking).
      hooks?.onBacktrack?.(current, method.name, depth);
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

      // Pre-validate: walk every task reachable from the goals (including all
      // subtasks referenced by methods) and fail fast with a precise error if
      // any task name is not registered.  This replaces the old goal-only check
      // and ensures UNKNOWN_TASK is reported even for deeply nested subtasks.
      const unknownTask = findFirstUnknownTask(goals, domain);
      if (unknownTask !== null) {
        return {
          success: false,
          reason: "UNKNOWN_TASK",
          failedTask: unknownTask,
        };
      }

      const result = solve([...goals], initialState, domain, [], 0, config.hooks);

      if (result === null) {
        // Determine the best failure reason by inspecting goal tasks.
        // For a precise per-task reason we do a lightweight single-pass check.
        for (const goal of goals) {
          if (hasOwnTask(domain.operators as Record<string, unknown>, goal)) {
            const op = domain.operators[goal];
            if (!op.condition(initialState)) {
              return {
                success: false,
                reason: "OPERATOR_PRECONDITION_FAILED",
                failedTask: goal,
              };
            }
          }
          if (hasOwnTask(domain.compoundTasks as Record<string, unknown>, goal)) {
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
        // Generic failure (e.g. a sub-task precondition failed deep in the tree).
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
    tasks: ReadonlyArray<string>
  ): PlanningResult<TState> {
    return createPlanner({ domain, initialState: state, goals: tasks }).plan();
  }
}
