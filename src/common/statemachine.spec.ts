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

// utility for simple waiting for next event loop, for waiting for listeners to fire
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  });

  it("can remove observer", async () => {
    const mockListener = jest.fn();

    const close = machine.observe(mockListener);

    machine.send("attemptConnection");
    await flush();

    expect(mockListener).toHaveBeenCalledWith("CONNECTING");
    expect(mockListener).toHaveBeenCalledTimes(1);

    mockListener.mockClear();
    close();

    machine.send("connectionSuccess");

    //flush several times to make extra sure the listener has not been fired
    await flush();
    await flush();
    await flush();

    expect(mockListener).not.toHaveBeenCalled();
  });

  it("can clear observers", async () => {
    const mockListener = jest.fn();

    machine.observe(mockListener);
    machine.close();

    machine.send("attemptConnection");

    await flush();
    await flush();
    await flush();

    expect(mockListener).not.toHaveBeenCalled();
  });
});
