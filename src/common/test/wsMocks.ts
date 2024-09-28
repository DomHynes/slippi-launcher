import EventEmitter from "events";

jest.mock("websocket", () => {
  const mockClient = new EventEmitter();
  // @ts-expect-error mocking
  mockClient.connect = jest.fn();
  // @ts-expect-error mocking
  mockClient.close = jest.fn();
  // @ts-expect-error mocking
  mockClient.abort = jest.fn();

  const mockConnection = new EventEmitter();
  // @ts-expect-error mocking
  mockConnection.close = jest.fn();
  // @ts-expect-error mocking
  mockConnection.send = jest.fn((_data, cb) => cb && cb());

  return {
    client: jest.fn().mockImplementation(() => mockClient),
    connection: jest.fn().mockImplementation(() => mockConnection),
  };
});

jest.mock("@slippi/slippi-js", () => {
  const DolphinConnection = new EventEmitter();
  // @ts-expect-error mocking
  DolphinConnection.connect = jest.fn(() => Promise.resolve());
  // @ts-expect-error mocking
  DolphinConnection.disconnect = jest.fn(() => Promise.resolve());

  // @ts-expect-error mocking
  DolphinConnection.getStatus = jest.fn(() => 0 as ConnectionStatus);

  return {
    ...jest.requireActual("@slippi/slippi-js"),
    DolphinConnection: jest.fn().mockImplementation(() => DolphinConnection),
  };
});
