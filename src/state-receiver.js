const { Serialize } = require('eosjs');
const Connection = require('./connection');
const createEosApi = require('./create-eos-api');
const serialize = require('./serialize');
const deserializeDeep = require('./deserialize-deep');

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

class StateReceiver {
  /**
   * @type {Connection}
   */
  connection;

  /**
   * @type {EosApi}
   */
  eosApi;

  /**
   * @type {Array<Buffer>}
   */
  serializedMessageQueue;

  /**
   * @type {Set<string>}
   */
  deserializerActionSet;

  /**
   * @type {number}
   */
  inflightMessageCount = 0;

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
   * @param {string[]} config.deserializerActions - list of actions to be deserialized. Ex: ['eosio.token::transfer', 'bridge.wax::reqnft']
   */
  constructor(config) {
    this.logger = config.logger || console;

    this.traceHandlers = [];

    if (!config.maxQueueSize) {
      config.maxQueueSize = 100;
    }

    this.config = Object.freeze(config);

    this.deserializerActionSet = new Set(config.deserializerActions || []);
    this.startBlock = config.startBlock || 0;
    this.endBlock = config.endBlock || '0xffffffff';
    this.current_block = -1;
    this.types = null;
    this.processingMessageData = false;
    this.init();

    if (!config.eosApi) {
      this.logger.info(`Creating eosApi with endpoint: ${config.eosEndpoint}`);
      this.eosApi = createEosApi(config.eosEndpoint);
    } else {
      this.eosApi = config.eosApi;
    }
    this.processCount = 0;
    this.debuging = process.env.DEBUG_STATE_RECEIVER == 1;
  }

  init() {
    this.serializedMessageQueue = [];
    // this.processingMessageData = false;

    /**
     * This needs to be reset so that the message handler know that
     * it is going to to get a first message as ABI
     */
    this.abi = null;
  }

  start() {
    this.logger.info(`==== Starting the receiver.`);

    if (this.processingMessageData == true) {
      if (this.debuging) {
        this.logger.info('Wait for processingMessageData to finish!');
      }
      let start = this.start.bind(this);
      setTimeout(start, 1000);
      return;
    }
    this.init();

    if (this.connection) {
      // close previous connection
      this.connection.disconnect();
      this.connection = null;
    }

    this.connection = new Connection({
      logger: this.logger,
      socketAddresses: Array.from(new Set(this.config.socketAddresses)),
      onError: (err) => this._onError(err),
      onMessage: this.onMessage.bind(this),
      onClose: () => {
        if (this.debuging) {
          this.logger.info(`Connection is closed. Restart!`);
        }
        this.start();
      },
    });

    this.connection.connect();
  }

  restart(startBlock, endBlock) {
    this.stop();

    this.startBlock = startBlock;
    this.endBlock = endBlock;

    this.start();
  }

  stop() {
    this.logger.info(`==== Receive stop command: stopping receiver.`);
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    this.logger.info(`==== Receiver is stopped.`);
  }

  /**
   * Register Trace Handler
   * @param {TraceHandler} h
   */
  registerTraceHandler(h) {
    if (!h || typeof h.processTrace !== 'function') {
      throw new Error(`Handler is not valid: missing 'processTrace'.`);
    }

    this.traceHandlers.push(h);
    if (h.contractName && h.actionName) {
      this.deserializerActionSet.add(`${h.contractName}::${h.actionName}`);
    }
  }

  onMessage(data) {
    try {
      if (!this.abi) {
        this.receivedAbi(data);
      } else {
        this.inflightMessageCount--;
        this.sendAck();

        if (this.debuging) {
          this.logger.info(`onMessage: add message to queue ${this.serializedMessageQueue.length}`);
        }

        // queuing data
        this.serializedMessageQueue.push(data);

        // Intentionally, not to block the receiving message from state node.
        // no "await" here.
        this.processMessageData(this.serializedMessageQueue).catch((err) => {
          this._onError(err);
        });
      }
    } catch (e) {
      this._onError(e);
    }
  }

  receivedAbi(data) {
    this.logger.info('Receiving abi...');
    this.abi = JSON.parse(data);
    this.types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), this.abi);

    // ready to request blocks
    this.requestBlocks();
  }

  requestBlocks() {
    let startBlock = parseInt(this.startBlock);
    if (this.current_block > 0) {
      startBlock = this.current_block + 1;
    } else {
      this.current_block = 0;
    }

    const args = {
      start_block_num: startBlock,
      end_block_num: parseInt(this.endBlock),
      max_messages_in_flight: this.config.maxQueueSize,
      have_positions: [],
      irreversible_only: true,
      fetch_block: true,
      fetch_traces: this.traceHandlers.length > 0,
      fetch_deltas: false,
    };

    this.logger.info(
      `Requesting blocks, Start : ${args.start_block_num}, End : ${args.end_block_num}, Max Messages In Flight : ${args.max_messages_in_flight}`
    );
    this.send(['get_blocks_request_v0', args]);
    this.inflightMessageCount = args.max_messages_in_flight;
  }

  requestStatus() {
    this.send(['get_status_request_v0', {}]);
  }

  sendAck() {
    const freeQueueSize =
      this.config.maxQueueSize - this.inflightMessageCount - this.serializedMessageQueue.length;
    if (freeQueueSize > 0) {
      this.send(['get_blocks_ack_request_v0', { num_messages: freeQueueSize }]);
      this.inflightMessageCount += freeQueueSize;
    } else {
      this.logger.info(`The max queue size is reached; pause the ACK and wait for processing.`);
    }
  }

  send(request) {
    if (this.connection && this.connection.ws && this.connection.connected == true) {
      this.connection.ws.send(serialize(this.types, 'request', request));
    } else {
      this.logger.warn('Connection is not ready, cannot send message.');
    }
  }

  /**
   *
   * @param {Array<Buffer>} serializedMessageQueue
   * @returns {Promise<void>}
   */
  async processMessageData(serializedMessageQueue) {
    if (this.processingMessageData) {
      return;
    }
    this.processCount += 1;
    if (this.debuging) {
      this.logger.info(
        `Enter processMessageData ${this.processCount}, ${this.processingMessageData}, ${serializedMessageQueue.length}`
      );
    }
    this.processingMessageData = true;

    // this.logger.debug(`Processing message data...`);
    try {
      const deserializingOptions = {
        deserializeTraces: true,
        actionSet: this.deserializerActionSet,
      };

      while (serializedMessageQueue.length > 0) {
        if (this.debuging) {
          this.logger.info(
            `Processing message loop ${this.processCount}, ${this.processingMessageData}, ${serializedMessageQueue.length}`
          );
        }
        const serializedMessage = serializedMessageQueue.shift();

        if (serializedMessageQueue.length < 2) {
          this.logger.info(
            `serializedMessageQueue.length is less than 2. Send ACK to receive more blocks.`
          );
          this.sendAck();
        }

        if (this.debuging) {
          this.logger.info(`Start deserialize block data`);
        }
        const blockData = await deserializeDeep({
          eosApi: this.eosApi,
          types: this.types,
          type: 'result',
          data: serializedMessage,
          options: deserializingOptions,
        });

        if (blockData[1] && blockData[1].this_block) {
          await this.deliverDeserializedBlock(blockData[1]);
        } else {
          this.logger.info(`Reached the head of the chain: ${JSON.stringify(blockData)}`);
        }
      }

      this.sendAck();
    } catch (err) {
      this._onError(err);
    } finally {
      this.processingMessageData = false;
      if (this.debuging) {
        this.logger.info(`Exit processMessageData ${this.processCount}`);
      }
    }
    // this.logger.debug(`Processing message data stop.`);
  }

  status() {
    return {
      start: this.startBlock,
      end: this.endBlock,
      current: this.current_block,
      serializedMessageQueueSize: this.serializedMessageQueue.length,
    };
  }

  async deliverDeserializedBlock(blockData) {
    if (!blockData || !blockData.this_block) {
      this.logger.warn(`Block data is not valid.`, blockData);
      return;
    }

    const block_num = +blockData.this_block.block_num;
    const block_time = blockData.block.timestamp;
    const head_block_num = blockData.head.block_num;
    const last_irreversible_block_num = blockData.last_irreversible.block_num;

    if (this.debuging) {
      this.logger.info(`deliverDeserializedBlock ${block_num}`);
    }

    for (const handler of this.traceHandlers) {
      await handler.processTrace(
        block_num,
        blockData.traces,
        block_time,
        head_block_num,
        last_irreversible_block_num
      );
    }

    this.current_block = block_num;
  }

  _onError(e) {
    if (typeof this.config.onError === 'function') {
      this.config.onError(e);
    } else {
      this.logger.error(e);
    }
  }
}

module.exports = StateReceiver;
