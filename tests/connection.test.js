const WebSocket = require('ws');
const Connection = require('../src/connection');
const logger = require('./logger');

// Captured before any test can spy on global.setTimeout, so sleeps here are always real.
const realSetTimeout = global.setTimeout;
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

jest.mock('ws');

describe('connection', () => {
  // 🔴 `jest.mock('ws')` automocks the CLASS, so `on` lives on the shared prototype: every
  // instance's `on.mock.calls` is the SAME accumulating array. Selecting a handler via
  // `WebSocket.mock.instances[1].on.mock.calls.find(...)` therefore returns the handler the FIRST
  // socket registered, silently. Slice by call offset instead — each connect() registers exactly
  // four handlers, in order: open, message, close, error.
  const onCallCount = () =>
    WebSocket.mock.instances.length ? WebSocket.mock.instances[0].on.mock.calls.length : 0;
  const handlersSince = (offset) => WebSocket.mock.instances[0].on.mock.calls.slice(offset);
  const grabHandler = (calls, evt) => calls.find(([e]) => e === evt)[1];
  it('initialize connection object', () => {
    const connection = new Connection({ maxConnectionRetries: 99 });
    expect(connection).toEqual(
      expect.objectContaining({
        connected: false,
        connecting: false,
        connectionRetries: 0,
        maxConnectionRetries: 99,
        socketAddresses: [],
        socket_index: -1,
        ws: null,
      })
    );
  });

  it('return next endpoint', () => {
    const connection = new Connection({ socketAddresses: ['e1', 'e2'] });
    expect(connection.nextEndpoint()).toEqual('e1');
    expect(connection.nextEndpoint()).toEqual('e2');
    expect(connection.nextEndpoint()).toEqual('e1');
    expect(connection.nextEndpoint()).toEqual('e2');
  });

  describe('_onClose', () => {
    it('code is not 1000', () => {
      const onClose = jest.fn();
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], onClose, logger });
      const spy_init = jest.spyOn(connection, 'init');
      connection._onClose();

      expect(onClose).toHaveBeenCalled();
      expect(spy_init).toHaveBeenCalled();
    });

    it('code 1000', () => {
      const onClose = jest.fn();
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], onClose });
      const spy_init = jest.spyOn(connection, 'init');
      const spy_reconnect = jest.spyOn(connection, 'reconnect').mockReturnValue();
      connection._onClose(1000);

      expect(onClose).toHaveBeenCalled();
      expect(spy_init).toHaveBeenCalled();
      expect(spy_reconnect).not.toHaveBeenCalled();
    });
  });

  describe('reconnect', () => {
    // `should reconnect` spies on global.setTimeout. Without this restore the spy LEAKS into every
    // later test in the file — and jest's fake timers refuse to install over a mocked setTimeout,
    // so the leak silently blocks any future timer-based test rather than failing here.
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should reconnect', async () => {
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });
      const spy_connect = jest.spyOn(connection, 'connect').mockReturnValue();
      const spy_setTimeout = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => cb());
      await connection.reconnect();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Retrying with delay of \d+ ms./)
      );
      expect(spy_setTimeout).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
      expect(spy_connect).toHaveBeenCalled();
    }, 10000);

    it('should exceeding max retry', async () => {
      const connection = new Connection({
        socketAddresses: ['e1', 'e2'],
        logger,
        maxConnectionRetries: 10,
      });
      connection.connectionRetries = 15;

      const spy_connect = jest.spyOn(connection, 'connect').mockReturnValue();

      await connection.reconnect();
      expect(logger.error).toHaveBeenCalledWith('Exceeded max reconnection attempts of 10.');
      expect(spy_connect).not.toHaveBeenCalledWith();
    });
  });

  describe('disconnect', () => {
    it('return if ws is null', () => {
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });
      connection.disconnect();

      expect(logger.info).not.toHaveBeenCalled();
    });
    it('disconnect current ws', () => {
      const ws = { close: jest.fn() };
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });
      connection.socket_index = 0;
      connection.ws = ws;
      connection.disconnect();

      expect(logger.info).toHaveBeenCalledWith('Closing websocket connection to e1.');
      expect(ws.close).toHaveBeenCalled();
      expect(connection.ws).toEqual(null);
    });
    it('ignore error if can not close connection', () => {
      const ws = {
        close: jest.fn(() => {
          throw new Error('error');
        }),
      };
      const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });
      connection.socket_index = 0;
      connection.ws = ws;
      connection.disconnect();

      expect(logger.info).toHaveBeenCalledWith('Closing websocket connection to e1.');
      expect(ws.close).toHaveBeenCalled();
      expect(connection.ws).toEqual(null);
    });
  });

  it('connect', () => {
    const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });
    const spy_disconnect = jest.spyOn(connection, 'disconnect').mockReturnValue();
    connection.connect();
    expect(spy_disconnect).toHaveBeenCalled();
    expect(WebSocket).toHaveBeenCalledWith('e1', { perMessageDeflate: false });
    expect(WebSocket.mock.instances[0].on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(WebSocket.mock.instances[0].on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(WebSocket.mock.instances[0].on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(WebSocket.mock.instances[0].on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  // ==========================================================================================
  // REGRESSION: the 2.3-day production wedge of 2026-09-08.
  //
  // account-claim-listener stopped consuming the chain for 2.3 days. There was NO :8080 socket at
  // any point, the retry ticked once per second throughout, and not one error was logged. Cause:
  // `connecting` is a latch whose only release paths are the `open` and `close` events. `error`
  // does not release it and `ws` applies no handshake timeout, so an attempt where NEITHER event
  // arrives leaves it set forever and every later connect() returns at the guard, silently.
  //
  // The mocked WebSocket is a faithful model of that peer: it registers handlers and never fires
  // one. If these tests are ever deleted, the wedge comes back silently.
  // ==========================================================================================
  describe('stuck handshake (regression: the 2026-09-08 wedge)', () => {
    // REAL timers with a deliberately tiny budget, not jest fake timers. Fake timers cannot be
    // installed in this file — an earlier test replaces global.setTimeout — and a 40 ms budget
    // exercises the same code path without the fight.
    const BUDGET = 40;

    beforeEach(() => {
      WebSocket.mockClear();
      logger.info.mockClear();
      logger.error.mockClear();
    });

    const build = (overrides = {}) =>
      new Connection({
        socketAddresses: ['e1', 'e2'],
        logger,
        onClose: jest.fn(),
        connectTimeoutMs: BUDGET,
        ...overrides,
      });

    it('THE BUG: a second connect() is refused while an attempt hangs', () => {
      const connection = build();
      connection.connect();
      expect(WebSocket).toHaveBeenCalledTimes(1);
      expect(connection.connecting).toBe(true);

      // No 'open', no 'close' — exactly the production peer. Under the OLD code this state was
      // permanent and this second call dialled nothing, forever, without a word.
      connection.connect();
      expect(WebSocket).toHaveBeenCalledTimes(1);
    });

    it('THE FIX: the guard releases itself once the handshake budget expires', async () => {
      const onClose = jest.fn();
      const connection = build({ onClose });
      connection.connect();
      expect(connection.connecting).toBe(true);

      await sleep(BUDGET / 4);
      expect(connection.connecting).toBe(true); // still within budget — must NOT fire early

      await sleep(BUDGET * 2);
      expect(connection.connecting).toBe(false); // the latch is released
      expect(connection.connected).toBe(false);
      expect(connection.ws).toBeNull();
      expect(onClose).toHaveBeenCalled(); // consumer's retry path is handed control
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`did not complete within ${BUDGET} ms`))
      );
    });

    it('THE POINT: after the timeout a later connect() actually dials again', async () => {
      const connection = build();
      connection.connect();
      await sleep(BUDGET * 2);

      connection.connect();
      expect(WebSocket).toHaveBeenCalledTimes(2); // recovery without a process restart
      expect(WebSocket).toHaveBeenLastCalledWith('e2', { perMessageDeflate: false });
    });

    it('a successful open cancels the timeout — a live socket is never torn down', async () => {
      const onClose = jest.fn();
      const connection = build({ onClose });
      connection.connect();

      const openHandler = grabHandler(handlersSince(0), 'open');
      openHandler();
      expect(connection.connected).toBe(true);

      await sleep(BUDGET * 3);
      expect(connection.connected).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('the guard LOGS when it declines — the silence is what cost 2.3 days', () => {
      const connection = build();
      connection.connect();
      logger.error.mockClear();

      connection.connect();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/connect\(\) declined: a connection attempt has been in progress/)
      );
    });

    it('the decline log is throttled, so a 1/s retry cannot flood', () => {
      // NO SLEEPS AND NO WALL-CLOCK RACE. An earlier draft used a 30 ms window and a 50-iteration
      // loop; it passed alone and failed in the full run, because under load the loop itself
      // outran the window. The elapsed window is simulated by rewinding the throttle stamp, which
      // tests the same branch deterministically.
      const WINDOW = 10000;
      const connection = build({ connectTimeoutMs: 0, declineLogMs: WINDOW });
      connection.connect();
      logger.error.mockClear();

      for (let i = 0; i < 50; i++) connection.connect();
      expect(logger.error).toHaveBeenCalledTimes(1); // 50 declines, one line

      connection._lastDeclineLog -= WINDOW + 1; // the window has now "elapsed"
      connection.connect();
      expect(logger.error).toHaveBeenCalledTimes(2); // and it speaks again
    });

    it('connectTimeoutMs <= 0 disables the timeout (opt-out preserves old behaviour)', async () => {
      const connection = build({ connectTimeoutMs: 0 });
      connection.connect();
      await sleep(BUDGET * 3);
      expect(connection.connecting).toBe(true);
    });
  });

  // ==========================================================================================
  // REGRESSION: cross-talk between socket generations.
  //
  // connect() calls disconnect() on the PREVIOUS socket, but that socket's handlers were bound as
  // `(e) => this._onClose(e)` — closed over the Connection, not over the socket. Its late 'close'
  // therefore lands on the CURRENT connection and calls init(), clearing connected/connecting for
  // a socket that is very much alive.
  // ==========================================================================================
  describe('stale socket generations', () => {
    beforeEach(() => {
      WebSocket.mockClear();
      logger.info.mockClear();
      logger.error.mockClear();
    });

    it('a late close from an abandoned socket cannot disturb the live one', () => {
      const onClose = jest.fn();
      const connection = new Connection({
        socketAddresses: ['e1', 'e2'],
        logger,
        onClose,
        connectTimeoutMs: 0,
      });

      connection.connect(); // generation 1 -> ws A
      const closeA = grabHandler(handlersSince(0), 'close');
      const afterA = onCallCount();

      // Force a second attempt, as the consumer's reconnect path would.
      connection.connected = false;
      connection.connecting = false;
      connection.connect(); // generation 2 -> ws B
      const openB = grabHandler(handlersSince(afterA), 'open');
      openB();
      expect(connection.connected).toBe(true);

      onClose.mockClear();
      closeA(1006); // ws A finally reports its close, long after being abandoned

      expect(connection.connected).toBe(true); // live socket untouched
      expect(onClose).not.toHaveBeenCalled(); // no spurious reconnect
    });

    it('a message from an abandoned socket is not delivered', () => {
      const onMessage = jest.fn();
      const connection = new Connection({
        socketAddresses: ['e1', 'e2'],
        logger,
        onMessage,
        connectTimeoutMs: 0,
      });

      connection.connect();
      const msgA = grabHandler(handlersSince(0), 'message');

      connection.connected = false;
      connection.connecting = false;
      connection.connect();

      msgA('stale block data');
      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  it('_onConnect', () => {
    const connection = new Connection({ socketAddresses: ['e1', 'e2'], logger });

    expect(connection).toEqual(
      expect.objectContaining({
        connected: false,
        connecting: false,
        connectionRetries: 0,
        maxConnectionRetries: 100,
        socketAddresses: ['e1', 'e2'],
        socket_index: -1,
        ws: null,
      })
    );

    connection._onConnect();

    expect(connection).toEqual(
      expect.objectContaining({
        connected: true,
        connecting: false,
        connectionRetries: 0,
        maxConnectionRetries: 100,
        socketAddresses: ['e1', 'e2'],
        socket_index: -1,
        ws: null,
      })
    );
  });
});
