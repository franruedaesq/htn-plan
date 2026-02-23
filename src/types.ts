/**
 * Represents the world state at any point during planning.
 * TState is a generic parameter so users get full TypeScript type safety
 * for their domain-specific state shape.
 */
export type State<TState> = TState;

/**
 * A Primitive Task (Operator) represents a directly executable action.
 *
 * @template TState - The shape of the world state.
 */
export interface Operator<TState> {
  /** Unique name for this operator. */
  readonly name: string;
  /**
   * Precondition: returns true when the operator is applicable
   * in the given state.
   */
  condition: (state: TState) => boolean;
  /**
   * Effect: returns a new (cloned & mutated) state that reflects
   * the world after this operator has been applied.
   * Must NOT mutate the original state in place.
   */
  effect: (state: TState) => TState;
}

/**
 * A single decomposition recipe for a Compound Task.
 * A method is applicable when its `condition` holds in the current state.
 * When applicable it provides an ordered list of sub-task names to pursue.
 *
 * @template TState - The shape of the world state.
 */
export interface Method<TState> {
  /** Human-readable name for this method (e.g. "TravelByCar"). */
  readonly name: string;
  /**
   * Precondition: returns true when this decomposition is valid
   * for the current state.
   */
  condition: (state: TState) => boolean;
  /**
   * Ordered list of sub-task names produced by this decomposition.
   * Each name must resolve to either an Operator or another Compound Task
   * registered in the domain.
   */
  subtasks: ReadonlyArray<string>;
}

/**
 * A named Compound Task together with all the methods that can decompose it.
 * The planner tries each method in order (first-valid-method / DFS).
 *
 * @template TState - The shape of the world state.
 */
export interface CompoundTask<TState> {
  /** Unique name for this compound task (e.g. "Travel"). */
  readonly name: string;
  /** All available decomposition recipes, tried in registration order. */
  methods: ReadonlyArray<Method<TState>>;
}

/**
 * The complete domain model passed to the planner.
 * It maps task names to either an Operator (primitive) or a CompoundTask.
 *
 * @template TState - The shape of the world state.
 */
export interface Domain<TState> {
  operators: Record<string, Operator<TState>>;
  compoundTasks: Record<string, CompoundTask<TState>>;
}

/**
 * Configuration options accepted by the planner.
 *
 * @template TState - The shape of the world state.
 */
export interface PlannerConfig<TState> {
  /** The domain describing all available tasks. */
  domain: Domain<TState>;
  /** The initial world state before planning begins. */
  initialState: TState;
  /** Top-level goal task names (resolved left-to-right). */
  goals: ReadonlyArray<string>;
}

/**
 * The result of a successful planning run:
 * a flat, chronologically ordered array of Operators ready for execution.
 *
 * @template TState - The shape of the world state.
 */
export type Plan<TState> = ReadonlyArray<Operator<TState>>;

/**
 * Reason codes returned when planning fails.
 */
export type PlanningFailureReason =
  | "NO_APPLICABLE_METHOD"
  | "OPERATOR_PRECONDITION_FAILED"
  | "UNKNOWN_TASK";

/**
 * Returned by the planner when no valid plan can be found.
 */
export interface PlanningFailure {
  success: false;
  reason: PlanningFailureReason;
  /** The task name that could not be resolved. */
  failedTask: string;
}

/**
 * Returned by the planner when a complete plan is found.
 *
 * @template TState - The shape of the world state.
 */
export interface PlanningSuccess<TState> {
  success: true;
  plan: Plan<TState>;
}

/**
 * Union result type returned by `createPlanner().plan()`.
 *
 * @template TState - The shape of the world state.
 */
export type PlanningResult<TState> = PlanningSuccess<TState> | PlanningFailure;
