export = Connection;
declare class Connection {
    constructor({ logger, socketAddresses, maxConnectionRetries, onError, onMessage, onClose, connectTimeoutMs, declineLogMs, }: {
        logger: any;
        socketAddresses: any;
        maxConnectionRetries: any;
        onError: any;
        onMessage: any;
        onClose: any;
        connectTimeoutMs: any;
        declineLogMs: any;
    });
    connected: boolean;
    connecting: boolean;
    /**
     * @type {WebSocket}
     */
    ws: WebSocket;
    logger: any;
    onError: any;
    onMessage: any;
    onClose: any;
    socket_index: number;
    connectionRetries: number;
    socketAddresses: any;
    maxConnectionRetries: any;
    connectTimeoutMs: number;
    declineLogMs: number;
    /**
     * Monotonic id for a connection ATTEMPT. Every handler registered in connect() closes over the
     * generation that registered it and returns early if it is no longer current, so a late event
     * from a socket we have already abandoned cannot mutate the state of the socket that replaced
     * it. Without this, `disconnect()`'s close lands on the CURRENT connection — the handlers are
     * bound to `this`, not to the socket — and clears `connected`/`connecting` for a live socket.
     */
    _generation: number;
    _connectTimer: NodeJS.Timeout;
    _connectingSince: number;
    _lastDeclineLog: number;
    _onConnect(): void;
    init(): void;
    connect(): void;
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
    _armConnectTimeout(generation: any, endpoint: any): void;
    _clearConnectTimeout(): void;
    /**
     * Abandon a stuck attempt: invalidate its handlers, tear the half-open socket down, release the
     * guard, and hand control back to the consumer's reconnect path via onClose().
     */
    _failAttempt(generation: any, message: any): void;
    /**
     * The silence this breaks is the reason the outage lasted 2.3 days rather than minutes: a guard
     * that returns early without saying so is indistinguishable from a retry that is working.
     * Throttled because the caller may poll once a second.
     */
    _logDeclined(): void;
    disconnect(): void;
    reconnect(): Promise<void>;
    nextEndpoint(): any;
    _onClose(code: any): void;
}
//# sourceMappingURL=connection.d.ts.map