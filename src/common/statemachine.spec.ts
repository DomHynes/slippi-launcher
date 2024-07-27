import { StateMachine } from "./statemachine";

enum SimpleMachineStates {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
}

interface SimpleActions {
  attemptConnection: Record<string, never>;
  connectionSuccess: Record<string, never>;
  connectionError: Record<string, never>;
  disconnect: Record<string, never>;
}

const getSimpleMachine = () => {
  const machine = new StateMachine<typeof SimpleMachineStates, SimpleActions>({
    initialState: SimpleMachineStates.DISCONNECTED,
    transitions: {
      [SimpleMachineStates.DISCONNECTED]: {
        on: {
          attemptConnection: {
            nextState: SimpleMachineStates.CONNECTING,
          },
        },
      },

      [SimpleMachineStates.CONNECTING]: {
        on: {
          connectionSuccess: {
            nextState: SimpleMachineStates.CONNECTED,
          },
          connectionError: {
            nextState: SimpleMachineStates.DISCONNECTED,
          },
        },
      },

      [SimpleMachineStates.CONNECTED]: {
        on: {
          disconnect: {
            nextState: SimpleMachineStates.DISCONNECTED,
          },
        },
      },
    },
  });

  return machine;
};

describe("StateMachine", () => {
  let machine = getSimpleMachine();

  beforeEach(() => {
    machine = getSimpleMachine();
  });

  afterEach(() => {
    machine.close();
  });

  it("transitions when valid", () => {
    expect(machine.state).toBe(SimpleMachineStates.DISCONNECTED);

    machine.send("attemptConnection");
    expect(machine.state).toBe(SimpleMachineStates.CONNECTING);
  });

  it("does not perform invalid transitions", () => {
    expect(machine.state).toBe(SimpleMachineStates.DISCONNECTED);

    machine.send("connectionSuccess");
    expect(machine.state).toBe(SimpleMachineStates.DISCONNECTED);
  });

  it("fires listener", async () => {
    const receivedUpdate = new Promise<keyof typeof SimpleMachineStates>((resolve, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for message")), 3000);

      machine.observe((newState) => resolve(newState));
    });

    machine.send("attemptConnection");

    expect(await receivedUpdate).toBe("CONNECTING");

    machine.close();
  });
});
