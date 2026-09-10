const WebSocket = require('ws');

/**
 * Default handshake budget. A WAX SHIP handshake on a healthy internal endpoint completes in
 * ~25 ms; 30 s is three orders of magnitude of headroom, chosen so this can only ever fire on a
 * genuinely stuck attempt and never on a slow one.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 30000;

/** How often `connect()` may log that it declined to act. It can be called ~1/s. */
const DEFAULT_DECLINE_LOG_MS = 60000;

class Connection {
  connected = false;
  connecting = false;

  /**
   * @type {WebSocket}
   */
  ws = null;

  constructor({
    logger,
    socketAddresses,
    maxConnectionRetries,
    onError,
    onMessage,
    onClose,
    connectTimeoutMs,
    declineLogMs,
  }) {
    this.logger = logger;

    this.onError = onError || (() => {});
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});

    this.socket_index = -1;
    this.connectionRetries = 0;
    this.socketAddresses = socketAddresses || [];
    this.maxConnectionRetries = maxConnectionRetries || 100;

    this.connectTimeoutMs = Number(
      connectTimeoutMs ??
        process.env.WAX_STATE_HISTORY_CONNECT_TIMEOUT_MS ??
        DEFAULT_CONNECT_TIMEOUT_MS
    );
    this.declineLogMs = Number(
      declineLogMs ?? process.env.WAX_STATE_HISTORY_DECLINE_LOG_MS ?? DEFAULT_DECLINE_LOG_MS
    );

    /**
     * Monotonic id for a connection ATTEMPT. Every handler registered in connect() closes over the
     * generation that registered it and returns early if it is no longer current, so a late event
     * from a socket we have already abandoned cannot mutate the state of the socket that replaced
     * it. Without this, `disconnect()`'s close lands on the CURRENT connection — the handlers are
     * bound to `this`, not to the socket — and clears `connected`/`connecting` for a live socket.
     */
    this._generation = 0;
    this._connectTimer = null;
    this._connectingSince = 0;
    this._lastDeclineLog = 0;

    this.init();
  }

  _onConnect() {
    this._clearConnectTimeout();
    this.connected = true;
    this.connecting = false;
    this.connectionRetries = 0;
  }

  init() {
    this._clearConnectTimeout();
    this.connected = false;
    this.connecting = false;
  }

  connect() {
    if (this.connected || this.connecting) {
      this._logDeclined();
      return;
    }
    this.connecting = true;
    this._connectingSince = Date.now();

    // Claim a new generation BEFORE disconnect(), so the outgoing socket's handlers — which are
    // bound to `this` and will fire later — are already stale and cannot touch the new attempt.
    const generation = ++this._generation;

    const endpoint = this.nextEndpoint();
    this.logger.info(`Websocket connecting to: ${endpoint}`);

    this.disconnect();

    this.ws = new WebSocket(endpoint, { perMessageDeflate: false });
    this.ws.on('open', () => {
      if (generation !== this._generation) return;
      this._onConnect();
    });
    this.ws.on('message', (data) => {
      if (generation !== this._generation) return;
      this.onMessage(data);
    });
    this.ws.on('close', (e) => {
      if (generation !== this._generation) return;
      this._onClose(e);
    });
    this.ws.on('error', (e) => {
      if (generation !== this._generation) return;
      this.onError(e);
    });

    this._armConnectTimeout(generation, endpoint);
  }

  /**
   * THE FIX FOR THE 2.3-DAY WEDGE.
   *
   * `connecting` is a latch whose ONLY release paths are the `open` and `close` events. `error`
   * does not release it, and `ws` applies no handshake timeout of its own — so an attempt where
   * NEITHER event ever arrives (a TCP connect that hangs, a peer that accepts and never completes
   * the upgrade) leaves `connecting === true` forever. Every later `connect()` then returns at the
   * guard, silently, and the consumer retries for as long as you let it without ever dialling.
   * Observed in production 2026-09-08: 2.3 days, no socket, not one error logged.
   *
   * A timeout is what makes the latch self-releasing regardless of which events the peer sends.
   */
  _armConnectTimeout(generation, endpoint) {
    this._clearConnectTimeout();
    if (!Number.isFinite(this.connectTimeoutMs) || this.connectTimeoutMs <= 0) return;

    this._connectTimer = setTimeout(() => {
      this._failAttempt(
        generation,
        `Websocket handshake to ${endpoint} did not complete within ${this.connectTimeoutMs} ms. ` +
          `Abandoning the attempt and releasing the connection guard.`
      );
    }, this.connectTimeoutMs);

    // Never hold the event loop open on account of a pending handshake. Guarded on the timer
    // itself, not just on `unref`: setTimeout does not always return a Node Timeout — under a
    // mocked or fake-timer setTimeout it can return undefined or a bare numeric id.
    if (this._connectTimer && typeof this._connectTimer.unref === 'function') {
      this._connectTimer.unref();
    }
  }

  _clearConnectTimeout() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }

  /**
   * Abandon a stuck attempt: invalidate its handlers, tear the half-open socket down, release the
   * guard, and hand control back to the consumer's reconnect path via onClose().
   */
  _failAttempt(generation, message) {
    if (generation !== this._generation) return;

    // Retire this generation so the socket we are about to close cannot re-enter through _onClose.
    this._generation++;

    this.logger.error(message);
    this.disconnect();
    this.init();
    this.onClose();
  }

  /**
   * The silence this breaks is the reason the outage lasted 2.3 days rather than minutes: a guard
   * that returns early without saying so is indistinguishable from a retry that is working.
   * Throttled because the caller may poll once a second.
   */
  _logDeclined() {
    const now = Date.now();
    if (now - this._lastDeclineLog < this.declineLogMs) return;
    this._lastDeclineLog = now;

    if (this.connecting) {
      const held = Math.round((now - this._connectingSince) / 1000);
      // `error`, not `warn`: this library calls ONLY logger.info and logger.error, and consumers
      // pass in their own logger. A `logger.warn is not a function` TypeError is not hypothetical
      // here — a sibling service crash-looped in production on exactly that shape for `info`.
      // Do not introduce a new logger method without auditing every consumer.
      this.logger.error(
        `connect() declined: a connection attempt has been in progress for ${held}s and has neither ` +
          `opened nor closed. If this repeats, the handshake is stuck; it will be abandoned after ` +
          `${this.connectTimeoutMs} ms.`
      );
    } else {
      this.logger.info('connect() declined: already connected.');
    }
  }

  disconnect() {
    if (this.ws == null) {
      return;
    }

    try {
      this.logger.info(
        `Closing websocket connection to ${this.socketAddresses[this.socket_index]}.`
      );
      this.ws.close();
    } catch (_e) {
      // safe to ignore error
    } finally {
      this.ws = null;
    }
  }

  async reconnect() {
    if (this.connectionRetries > this.maxConnectionRetries) {
      this.logger.error(`Exceeded max reconnection attempts of ${this.maxConnectionRetries}.`);
    } else {
      this.connectionRetries++;

      const timeout = Math.round(Math.pow(2, this.connectionRetries / 5) * 1000);
      this.logger.info(`Retrying with delay of ${timeout} ms.`);

      await new Promise((resolve) =>
        setTimeout(() => {
          this.connect();
          resolve();
        }, timeout)
      );
    }
  }

  nextEndpoint() {
    let next_index = ++this.socket_index;

    if (next_index >= this.socketAddresses.length) {
      next_index = 0;
    }
    this.socket_index = next_index;

    return this.socketAddresses[this.socket_index];
  }

  _onClose(code) {
    this.init();
    this.onClose();
    // 1000 = closed by me normally
    if (code !== 1000) {
      this.logger.error(
        `Websocket disconnected from ${this.socketAddresses[this.socket_index]} with code ${code}.`
      );
    }
  }
} // Connection

module.exports = Connection;
