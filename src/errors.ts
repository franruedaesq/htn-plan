/**
 * Thrown when the HTN planner exceeds its maximum recursion depth,
 * which typically indicates a cyclic task decomposition (infinite loop).
 *
 * @example
 * ```ts
 * try {
 *   createPlanner({ domain, initialState, goals }).plan();
 * } catch (err) {
 *   if (err instanceof PlannerMaxDepthError) {
 *     console.error("Cyclic decomposition detected!");
 *   }
 * }
 * ```
 */
export class PlannerMaxDepthError extends Error {
  constructor(maxDepth: number = 1000) {
    super(
      `HTN planner exceeded the maximum recursion depth of ${maxDepth}. ` +
        "This usually indicates a cyclic task decomposition."
    );
    this.name = "PlannerMaxDepthError";
  }
}

/**
 * Thrown by {@link Domain.validate} when the domain contains references to
 * tasks that have not been registered (broken subtask links).
 *
 * @example
 * ```ts
 * try {
 *   domain.validate();
 * } catch (err) {
 *   if (err instanceof DomainValidationError) {
 *     console.error(`Unresolved task: ${err.unresolvedTask}`);
 *   }
 * }
 * ```
 */
export class DomainValidationError extends Error {
  /** The task name that is referenced but not registered in the domain. */
  readonly unresolvedTask: string;

  constructor(unresolvedTask: string) {
    super(
      `Domain validation failed: task "${unresolvedTask}" is referenced as a subtask ` +
        "but is not registered as an operator or compound task."
    );
    this.name = "DomainValidationError";
    this.unresolvedTask = unresolvedTask;
  }
}
