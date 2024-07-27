type Listener<TStates> = (newState: keyof TStates) => void;

type Transitions<TStates, TActions> = {
  [State in keyof TStates]?: {
    on: {
      [Action in keyof TActions]?: {
        nextState?: keyof TStates;
        action?: (args: TActions[Action]) => void;
      };
    };
  };
};

class StateMachine<TStates, TActions> {
  public state: keyof TStates;
  private initialState: keyof TStates;
  private listeners: Set<Listener<TStates>>;
  private transitions: Transitions<TStates, TActions>;

  constructor(options: { transitions: Transitions<TStates, TActions>; initialState: keyof TStates }) {
    this.transitions = options.transitions;
    this.initialState = options.initialState;

    this.state = options.initialState;
    this.listeners = new Set();
  }

  private updateState(newState: keyof TStates) {
    console.log(`STATE TRANSITIONING ${String(this.state)} => ${String(newState)}`);
    this.state = newState;
    this.listeners.forEach((l) => setTimeout(() => l(newState)), 0); // setImmediate throwing in jest :shrug:
  }

  private stopObserver(listener: Listener<TStates>) {
    const existed = this.listeners.delete(listener);

    if (!existed) {
      console.error(new Error("attempted to remove nonexistent listener"));
    }
  }

  public observe(listener: Listener<TStates>) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public send(name: keyof TActions) {
    const nextState = this.transitions[this.state]?.on?.[name]?.nextState;
    if (nextState) {
      this.updateState(nextState);
      return;
    }

    console.warn(new Error(`Invalid state transition attempted!  ${String(this.state)} => ${String(name)}`));
  }

  public close() {
    this.state = this.initialState;

    this.listeners.forEach((listener) => {
      this.stopObserver(listener);
    });
  }
}

export { StateMachine, Transitions };
