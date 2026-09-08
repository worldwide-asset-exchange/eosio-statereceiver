export = StateReceiver;
/**
 * @typedef {import('eosjs').Api} EosApi
 */
/**
 * @callback ProcessTrace
 * @param {number} block_num
 * @param {Array<*>} traces
 * @param {string} block_time
 * @returns {Promise<void>}
 */
/**
 * @typedef {Object} TraceHandler
 * @property {string} contractName interest in contract name
 * @property {string} actionName interest in action name
 * @property {ProcessTrace} processTrace handler function
 */
declare class StateReceiver {
    /**
     * @param {Object} config - StateReceiver configuration
     * @param {number} config.startBlock - default 0,
     * @param {number} config.endBlock - default 0xffffffff
     * @param {string[]} config.socketAddresses - websoket endpoint (state history node)
     * @param {EosApi} config.eosApi - EosApi object. This is for deserializing action data. If it is not provided, it will be created.
     * @param {string} config.eosEndpoint - endpoint of eos history node. This is required for deserializing action data.
     * @param {object} config.logger - default is console
     * @param {function} config.onError - error handler
     * @param {number} config.maxQueueSize - max buffer message size, default 100
     * @param {boolean} config.fetchBlockTime - fetch block time, default true
     * @param {string[]} config.deserializerActions - list of actions to be deserialized. Ex: ['eosio.token::transfer', 'bridge.wax::reqnft']
     */
    constructor(config: {
        startBlock: number;
        endBlock: number;
        socketAddresses: string[];
        eosApi: EosApi;
        eosEndpoint: string;
        logger: object;
        onError: Function;
        maxQueueSize: number;
        fetchBlockTime: boolean;
        deserializerActions: string[];
    });
    /**
     * @type {Connection}
     */
    connection: Connection;
    /**
     * @type {EosApi}
     */
    eosApi: EosApi;
    /**
     * @type {Array<Buffer>}
     */
    serializedMessageQueue: Array<Buffer>;
    /**
     * @type {Set<string>}
     */
    deserializerActionSet: Set<string>;
    /**
     * @type {number}
     */
    inflightMessageCount: number;
    /**
     * @type {boolean}
     */
    fetchBlockTime: boolean;
    logger: any;
    traceHandlers: any[];
    config: Readonly<{
        startBlock: number;
        endBlock: number;
        socketAddresses: string[];
        eosApi: EosApi;
        eosEndpoint: string;
        logger: object;
        onError: Function;
        maxQueueSize: number;
        fetchBlockTime: boolean;
        deserializerActions: string[];
    }>;
    startBlock: number;
    endBlock: string | number;
    current_block: number;
    types: Map<string, Serialize.Type>;
    processingMessageData: boolean;
    /**
     * Incremented on every start()/reconnect. A processMessageData() invocation captures this
     * value and abandons itself as soon as it no longer matches, so a batch belonging to a dead
     * connection can never deliver blocks, ACK, or clear the in-progress flag of a live one.
     */
    _connectionEpoch: number;
    processCount: number;
    debuging: boolean;
    /** One get_blocks_ack per processed message (num_messages:1). Fixes throughput with some state-history nodes. */
    _ackEachBlock: boolean;
    _lastAckBackpressureLog: number;
    _ackBackpressureLogMs: number;
    _drainBackoffMs: number;
    _statsLog: boolean;
    _statsIntervalMs: number;
    _statsWindowStartHr: bigint;
    _statsBlocksInWindow: number;
    init(): void;
    /**
     * This needs to be reset so that the message handler know that
     * it is going to to get a first message as ABI
     */
    abi: any;
    start(): void;
    restart(startBlock: any, endBlock: any): void;
    stop(): void;
    /**
     * Register Trace Handler
     * @param {TraceHandler} h
     */
    registerTraceHandler(h: TraceHandler): void;
    onMessage(data: any): void;
    receivedAbi(data: any): void;
    requestBlocks(): void;
    requestStatus(): void;
    _logBackpressure(level: any, msg: any): void;
    sendAck(): void;
    sendAckOne(): void;
    send(request: any): void;
    /**
     * Rolling blocks/sec and ETA to chain head / LIB (irreversible stream).
     * @param {object} result - get_blocks_result_v0 payload (blockData[1])
     */
    _maybeEmitSyncStats(result: object): void;
    /**
     *
     * @param {Array<Buffer>} serializedMessageQueue
     * @returns {Promise<void>}
     */
    processMessageData(serializedMessageQueue: Array<Buffer>): Promise<void>;
    status(): {
        start: number;
        end: string | number;
        current: number;
        serializedMessageQueueSize: number;
    };
    deliverDeserializedBlock(blockData: any): Promise<void>;
    _onError(e: any): void;
}
declare namespace StateReceiver {
    export { EosApi, ProcessTrace, TraceHandler };
}
import Connection = require("./connection");
type EosApi = import('eosjs').Api;
import { Serialize } from "eosjs";
type TraceHandler = {
    /**
     * interest in contract name
     */
    contractName: string;
    /**
     * interest in action name
     */
    actionName: string;
    /**
     * handler function
     */
    processTrace: ProcessTrace;
};
type ProcessTrace = (block_num: number, traces: Array<any>, block_time: string) => Promise<void>;
//# sourceMappingURL=state-receiver.d.ts.map