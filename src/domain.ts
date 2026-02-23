import type { Domain as IDomain, Operator, Method, CompoundTask } from "./types";

/**
 * A mutable registry that builds a Domain by incrementally registering
 * Operators (primitive tasks) and Methods (compound-task decompositions).
 *
 * Implements the {@link IDomain} interface so it can be passed directly
 * to {@link createPlanner} without any conversion step.
 *
 * @template TState - The shape of the world state.
 *
 * @example
 * ```ts
 * const domain = new Domain<RobotState>()
 *   .registerOperator({ name: "Move", condition: s => s.battery > 0, effect: s => ({ ...s, location: "Kitchen" }) })
 *   .registerMethod("FetchCoffee", { name: "StandardFetch", condition: () => true, subtasks: ["Move"] });
 * ```
 */
export class Domain<TState> implements IDomain<TState> {
  /** Primitive tasks (Operators) keyed by name. */
  readonly operators: Record<string, Operator<TState>> = {};

  /** Compound tasks keyed by name. Each entry shares the same methods array
   *  as the internal `_compoundMethods` map so late registrations are visible
   *  immediately. */
  readonly compoundTasks: Record<string, CompoundTask<TState>> = {};

  /** Mutable backing store for each compound task's method list. */
  private readonly _compoundMethods: Record<string, Method<TState>[]> = {};

  /**
   * Register a primitive task (Operator).
   * Overwrites any existing operator with the same name.
   *
   * @returns `this` for fluent chaining.
   */
  registerOperator(operator: Operator<TState>): this {
    this.operators[operator.name] = operator;
    return this;
  }

  /**
   * Register a decomposition Method under the compound task identified by
   * `taskName`.  The compound task entry is created automatically on first
   * use; subsequent calls append methods in registration order.
   *
   * @returns `this` for fluent chaining.
   */
  registerMethod(taskName: string, method: Method<TState>): this {
    if (!(taskName in this._compoundMethods)) {
      this._compoundMethods[taskName] = [];
      this.compoundTasks[taskName] = {
        name: taskName,
        methods: this._compoundMethods[taskName],
      };
    }
    this._compoundMethods[taskName].push(method);
    return this;
  }

  /**
   * Retrieve an Operator by name.
   *
   * @returns The {@link Operator} or `undefined` if not registered.
   */
  getOperator(name: string): Operator<TState> | undefined {
    return this.operators[name];
  }

  /**
   * Retrieve a Method by its name, searching across all compound tasks.
   *
   * @returns The first {@link Method} whose `name` matches, or `undefined`.
   */
  getMethod(name: string): Method<TState> | undefined {
    for (const methods of Object.values(this._compoundMethods)) {
      const found = methods.find((m) => m.name === name);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
}
