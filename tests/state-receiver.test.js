const { Serialize } = require('eosjs');
const StateReceiver = require('../src/state-receiver');
const Connection = require('../src/connection');
const serialize = require('../src/serialize');
const deserializeDeep = require('../src/deserialize-deep');

jest.mock('eosjs');
jest.mock('../src/serialize');
jest.mock('../src/deserialize-deep');
jest.mock('../src/connection', () => {
  return jest.fn(function Connection() {
    this.ws = {
      send: jest.fn(),
    };
    this.connect = jest.fn();
    this.disconnect = jest.fn();
  });
});

const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const defaultConfig = {
  logger,
  startBlock: 20284880,
  socketAddresses: ['ws://localhost:8080'],
  eosEndpoint: 'http://localhost:8888',
  deserializerActions: ['eosio.token::transfer', 'bridge.wax::reqnft'],
};

function createStateReceiver(config) {
  return new StateReceiver({
    ...defaultConfig,
    ...config,
  });
}

function createConnection() {
  return {
    ws: {
      send: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('state receiver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sendAck', () => {
    const sr = createStateReceiver();
    sr.types = { abi: 'abi' };
    sr.connection = createConnection();
    sr.connection.connected = true;
    serialize.mockReturnValue('serialized message');

    sr.sendAck(15);

    expect(serialize).toBeCalledWith(sr.types, 'request', [
      'get_blocks_ack_request_v0',
      { num_messages: 15 },
    ]);
    expect(sr.connection.ws.send).toBeCalledWith('serialized message');
  });

  it('requestStatus', () => {
    const sr = createStateReceiver();
    const spy_send = jest.spyOn(sr, 'send').mockReturnValue();

    sr.requestStatus();

    expect(spy_send).toBeCalledWith(['get_status_request_v0', {}]);
  });

  it('requestBlocks', () => {
    const sr = createStateReceiver();
    const spy_send = jest.spyOn(sr, 'send').mockReturnValue();

    sr.requestBlocks();

    expect(logger.info).toBeCalledWith(
      'Requesting blocks, Start : 20284880, End : 4294967295, Max Messages In Flight : 5'
    );
    expect(spy_send).toBeCalledWith([
      'get_blocks_request_v0',
      {
        end_block_num: 4294967295,
        fetch_block: true,
        fetch_deltas: false,
        fetch_traces: false,
        have_positions: [],
        irreversible_only: true,
        max_messages_in_flight: 5,
        start_block_num: 20284880,
      },
    ]);
  });

  it('requestBlocks with current block num when reconnect websocket', () => {
    const sr = createStateReceiver();
    const spy_send = jest.spyOn(sr, 'send').mockReturnValue();

    sr.current_block = 20284992;

    sr.requestBlocks();

    expect(logger.info).toBeCalledWith(
      'Requesting blocks, Start : 20284993, End : 4294967295, Max Messages In Flight : 5'
    );
    expect(spy_send).toBeCalledWith([
      'get_blocks_request_v0',
      {
        end_block_num: 4294967295,
        fetch_block: true,
        fetch_deltas: false,
        fetch_traces: false,
        have_positions: [],
        irreversible_only: true,
        max_messages_in_flight: 5,
        start_block_num: sr.current_block + 1,
      },
    ]);
  });

  it('receivedAbi', () => {
    const sr = createStateReceiver();
    const spy_requestBlocks = jest.spyOn(sr, 'requestBlocks').mockImplementation(() => {});

    const abi = '{ "abi": "json" }';
    sr.receivedAbi(abi);

    expect(logger.info).toBeCalledWith('Receiving abi...');
    expect(Serialize.getTypesFromAbi).toBeCalledWith(undefined, JSON.parse(abi));
    expect(spy_requestBlocks).toBeCalled();
  });

  it('status', () => {
    const sr = createStateReceiver();
    expect(sr.status()).toEqual({
      current: -1,
      end: '0xffffffff',
      pauseAck: false,
      serializedMessageQueueSize: 0,
      start: 20284880,
    });
  });

  it('restart', () => {
    const sr = createStateReceiver({
      startBlock: 10,
      endBlock: 100,
    });
    const spy_stop = jest.spyOn(sr, 'stop').mockReturnValue();
    const spy_start = jest.spyOn(sr, 'start').mockReturnValue();
    expect(sr.startBlock).toEqual(10);
    expect(sr.endBlock).toEqual(100);
    expect(sr.restart(15, 20)).toEqual(undefined);
    expect(sr.startBlock).toEqual(15);
    expect(sr.endBlock).toEqual(20);
    expect(spy_stop).toBeCalled();
    expect(spy_start).toBeCalled();
  });

  it('init', () => {
    const sr = createStateReceiver();
    sr.serializedMessageQueue = [1];
    sr.pauseAck = true;

    expect(sr).toEqual(
      expect.objectContaining({
        pauseAck: true,
        serializedMessageQueue: [1],
      })
    );
    expect(sr.init()).toBeUndefined();
    expect(sr).toEqual(
      expect.objectContaining({
        pauseAck: false,
        serializedMessageQueue: [],
      })
    );
  });

  describe('start', () => {
    it('connection is not null', () => {
      const sr = createStateReceiver();
      const spy_init = jest.spyOn(sr, 'init');
      sr.abi = 'abc';
      const connection1 = createConnection();
      sr.connection = connection1;
      sr.start();

      const connection2 = sr.connection;

      expect(sr.abi).toBeNull();
      expect(connection1.disconnect).toBeCalled();
      expect(connection2.connect).toBeCalled();
      expect(connection2.disconnect).not.toBeCalled();
      expect(spy_init).toBeCalled();
    });
    it('connection is null', () => {
      const sr = createStateReceiver();
      const spy_init = jest.spyOn(sr, 'init');
      sr.start();
      expect(Connection).toBeCalledWith({
        logger,
        onClose: expect.any(Function),
        onError: expect.any(Function),
        onMessage: expect.any(Function),
        socketAddresses: ['ws://localhost:8080'],
      });
      expect(sr.connection.connect).toBeCalled();
      expect(spy_init).toBeCalled();
    });
  });

  describe('stop', () => {
    it('connection is null', () => {
      const sr = createStateReceiver();
      const spy_init = jest.spyOn(sr, 'init').mockReturnValue();
      sr.stop();
      expect(spy_init).not.toBeCalled();
    });
    it('connection is not null', () => {
      const sr = createStateReceiver();
      const connection = {
        disconnect: jest.fn(),
      };
      sr.connection = connection;
      const spy_init = jest.spyOn(sr, 'init').mockReturnValue();

      sr.stop();

      expect(connection.disconnect).toBeCalled();
      expect(spy_init).not.toBeCalled();
    });
  });

  describe('processMessageData', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('normal case', async () => {
      const serializedMessageQueue = ['msg1', 'msg2'];
      const sr = createStateReceiver({
        eosApi: { name: 'eos-api' },
      });
      const spy_deliverDeserializedBlock = jest
        .spyOn(sr, 'deliverDeserializedBlock')
        .mockResolvedValue();
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockResolvedValue();
      const actionSet = new Set(['eosio.token::transfer', 'bridge.wax::reqnft']);

      deserializeDeep.mockResolvedValueOnce(['a', { this_block: 'b1' }]);
      deserializeDeep.mockResolvedValueOnce(['a', { this_block: 'b2' }]);

      await sr.processMessageData(serializedMessageQueue);

      expect(deserializeDeep).toHaveBeenCalledTimes(2);
      expect(deserializeDeep).toHaveBeenNthCalledWith(1, {
        data: 'msg1',
        eosApi: { name: 'eos-api' },
        options: {
          actionSet,
          deserializeTraces: true,
        },
        type: 'result',
        types: null,
      });
      expect(deserializeDeep).toHaveBeenNthCalledWith(2, {
        data: 'msg2',
        eosApi: { name: 'eos-api' },
        options: {
          actionSet,
          deserializeTraces: true,
        },
        type: 'result',
        types: null,
      });

      expect(spy_deliverDeserializedBlock).toHaveBeenCalledTimes(2);
      expect(spy_deliverDeserializedBlock).toHaveBeenNthCalledWith(1, { this_block: 'b1' });
      expect(spy_deliverDeserializedBlock).toHaveBeenNthCalledWith(2, { this_block: 'b2' });

      expect(spy_sendAck).not.toBeCalled();
    });

    it('when reached the head block, the value of `this_block` is NULL', async () => {
      const { Serialize } = require('eosjs');
      const abi = require('./abi.json');
      const types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), abi);
      const msgData = Buffer.from([
        1, 167, 251, 148, 2, 2, 148, 251, 167, 148, 188, 11, 194, 167, 149, 180, 235, 9, 152, 225,
        83, 94, 9, 249, 232, 125, 62, 222, 155, 215, 192, 134, 211, 73, 116, 189, 190, 165, 251,
        148, 2, 2, 148, 251, 165, 159, 182, 108, 209, 105, 143, 67, 174, 252, 212, 204, 99, 10, 59,
        37, 111, 166, 109, 62, 155, 229, 151, 79, 160, 159, 108, 154, 138, 0, 0, 0, 0, 0,
      ]);
      const serializedMessageQueue = [msgData];
      const onError = jest.fn((err) => {
        console.error(err.message);
      });
      const sr = createStateReceiver({
        eosApi: { name: 'eos-api' },
        onError,
      });
      sr.types = types;

      const spy_deliverDeserializedBlock = jest
        .spyOn(sr, 'deliverDeserializedBlock')
        .mockResolvedValue();
      jest.spyOn(sr, 'sendAck').mockResolvedValue();
      const actionSet = new Set(['eosio.token::transfer', 'bridge.wax::reqnft']);
      deserializeDeep.mockReturnValue([
        'get_blocks_result_v0',
        {
          block: null,
          deltas: null,
          head: {
            block_id: '0294FBA794BC0BC2A795B4EB0998E1535E09F9E87D3EDE9BD7C086D34974BDBE',
            block_num: 43318183,
          },
          last_irreversible: {
            block_id: '0294FBA59FB66CD1698F43AEFCD4CC630A3B256FA66D3E9BE5974FA09F6C9A8A',
            block_num: 43318181,
          },
          prev_block: null,
          this_block: null,
          traces: null,
        },
      ]);

      await sr.processMessageData(serializedMessageQueue);

      expect(serializedMessageQueue.length).toEqual(0);
      expect(deserializeDeep).toHaveBeenCalledTimes(1);
      expect(deserializeDeep).toHaveBeenNthCalledWith(1, {
        data: msgData,
        eosApi: { name: 'eos-api' },
        options: {
          actionSet,
          deserializeTraces: true,
        },
        type: 'result',
        types,
      });

      expect(onError).not.toBeCalled();
      expect(spy_deliverDeserializedBlock).toHaveBeenCalledTimes(0);
      expect(logger.info).toHaveBeenCalledWith(
        'Reached the head of the chain: ["get_blocks_result_v0",{"block":null,"deltas":null,"head":{"block_id":"0294FBA794BC0BC2A795B4EB0998E1535E09F9E87D3EDE9BD7C086D34974BDBE","block_num":43318183},"last_irreversible":{"block_id":"0294FBA59FB66CD1698F43AEFCD4CC630A3B256FA66D3E9BE5974FA09F6C9A8A","block_num":43318181},"prev_block":null,"this_block":null,"traces":null}]'
      );
    });

    it('pauseAck is true 1', async () => {
      const serializedMessageQueue = ['msg1', 'msg2'];
      const sr = createStateReceiver({
        eosApi: { name: 'eos-api' },
      });
      jest.spyOn(sr, 'deliverDeserializedBlock').mockResolvedValue();
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockResolvedValue();

      sr.pauseAck = true;
      deserializeDeep.mockResolvedValue(['a', 'b1']);

      await sr.processMessageData(serializedMessageQueue);

      expect(spy_sendAck).toHaveBeenCalledTimes(1);
      expect(spy_sendAck).toBeCalledWith(1);
    });

    it('pauseAck is true 2', async () => {
      const serializedMessageQueue = ['msg1', 'msg2', 'msg3', 'msg4', 'msg5', 'msg6'];
      const sr = createStateReceiver({
        eosApi: { name: 'eos-api' },
      });
      jest.spyOn(sr, 'deliverDeserializedBlock').mockResolvedValue();
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockResolvedValue();

      sr.pauseAck = true;
      deserializeDeep.mockResolvedValue(['a', 'b1']);

      await sr.processMessageData(serializedMessageQueue);

      expect(spy_sendAck).toHaveBeenCalledTimes(1);
      expect(spy_sendAck).toBeCalledWith(1);
    });
  });

  describe('registerTraceHandler', () => {
    it('should register a handler', () => {
      const sr = createStateReceiver();
      const handler = {};
      expect(() => sr.registerTraceHandler(handler)).toThrow(
        `Handler is not valid: missing 'processTrace'.`
      );
    });
    it('should register a good handler 1', () => {
      const sr = createStateReceiver();
      const handler = {
        processTrace: jest.fn(),
        contractName: 'contract1',
        actionName: 'action1',
      };
      sr.registerTraceHandler(handler);
      expect(sr.traceHandlers).toEqual([handler]);
      expect(sr.deserializerActionSet.has('contract1::action1')).toEqual(true);
    });
    it('should register a good handler 2', () => {
      const sr = createStateReceiver();
      const handler = {
        processTrace: jest.fn(),
      };
      sr.registerTraceHandler(handler);
      expect(sr.traceHandlers).toEqual([handler]);
      expect(sr.deserializerActionSet.has('contract1::action1')).toEqual(false);
    });
  });

  describe('_onError', () => {
    it('config.onError is not function', () => {
      const sr = createStateReceiver();
      const error = new Error('test');
      expect(sr._onError(error)).toEqual(undefined);
      expect(logger.error).toBeCalledWith(error);
    });
    it('config.onError is function', () => {
      const onError = jest.fn();
      const sr = createStateReceiver({ onError });
      const error = new Error('test');
      expect(sr._onError(error)).toEqual(undefined);
      expect(logger.error).not.toBeCalled();
      expect(onError).toBeCalledWith(error);
    });
  });

  describe('deliverDeserializedBlock', () => {
    it('block data is null', async () => {
      const blockData = null;
      const sr = createStateReceiver();

      await sr.deliverDeserializedBlock(blockData);
      expect(logger.warn).toBeCalledWith('Block data is not valid.', blockData);
    });
    it('block data is not valid', async () => {
      const blockData = {};
      const sr = createStateReceiver();

      await sr.deliverDeserializedBlock(blockData);
      expect(logger.warn).toBeCalledWith('Block data is not valid.', blockData);
    });
    it('block data is valid', async () => {
      const jsonBlock = {
        0: 172,
        1: 218,
        2: 60,
        3: 84,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 234,
        10: 48,
        11: 85,
        12: 0,
        13: 0,
        14: 2,
        15: 112,
        16: 173,
        17: 158,
        18: 115,
        19: 117,
        20: 83,
        21: 120,
        22: 7,
        23: 146,
        24: 106,
        25: 216,
        26: 2,
        27: 229,
        28: 212,
        29: 184,
        30: 133,
        31: 158,
        32: 144,
        33: 211,
        34: 83,
        35: 10,
        36: 219,
        37: 58,
        38: 131,
        39: 53,
        40: 12,
        41: 247,
        42: 96,
        43: 60,
        44: 12,
        45: 57,
        46: 166,
        47: 219,
        48: 93,
        49: 89,
        50: 202,
        51: 68,
        52: 40,
        53: 234,
        54: 62,
        55: 93,
        56: 73,
        57: 27,
        58: 180,
        59: 238,
        60: 197,
        61: 1,
        62: 210,
        63: 195,
        64: 80,
        65: 137,
        66: 228,
        67: 226,
        68: 20,
        69: 50,
        70: 52,
        71: 143,
        72: 70,
        73: 171,
        74: 139,
        75: 183,
        76: 3,
        77: 8,
        78: 113,
        79: 47,
        80: 109,
        81: 0,
        82: 153,
        83: 186,
        84: 105,
        85: 215,
        86: 107,
        87: 202,
        88: 108,
        89: 57,
        90: 172,
        91: 146,
        92: 130,
        93: 48,
        94: 50,
        95: 185,
        96: 3,
        97: 209,
        98: 130,
        99: 228,
        100: 208,
        101: 41,
        102: 172,
        103: 87,
        104: 18,
        105: 80,
        106: 133,
        107: 120,
        108: 129,
        109: 210,
        110: 0,
        111: 0,
        112: 0,
        113: 0,
        114: 0,
        115: 0,
        116: 0,
        117: 31,
        118: 62,
        119: 151,
        120: 239,
        121: 93,
        122: 224,
        123: 189,
        124: 29,
        125: 187,
        126: 237,
        127: 42,
        128: 194,
        129: 159,
        130: 38,
        131: 222,
        132: 241,
        133: 77,
        134: 147,
        135: 248,
        136: 226,
        137: 96,
        138: 190,
        139: 169,
        140: 213,
        141: 160,
        142: 116,
        143: 61,
        144: 248,
        145: 35,
        146: 12,
        147: 83,
        148: 103,
        149: 162,
        150: 110,
        151: 57,
        152: 125,
        153: 25,
        154: 97,
        155: 201,
        156: 19,
        157: 58,
        158: 231,
        159: 13,
        160: 159,
        161: 233,
        162: 116,
        163: 206,
        164: 151,
        165: 195,
        166: 121,
        167: 4,
        168: 163,
        169: 179,
        170: 44,
        171: 98,
        172: 7,
        173: 212,
        174: 139,
        175: 192,
        176: 45,
        177: 26,
        178: 183,
        179: 209,
        180: 86,
        181: 223,
        182: 2,
        183: 0,
        184: 252,
        185: 0,
        186: 0,
        187: 0,
        188: 21,
        189: 1,
        190: 1,
        191: 0,
        192: 31,
        193: 7,
        194: 44,
        195: 21,
        196: 35,
        197: 71,
        198: 60,
        199: 32,
        200: 223,
        201: 210,
        202: 162,
        203: 188,
        204: 98,
        205: 106,
        206: 239,
        207: 231,
        208: 50,
        209: 179,
        210: 65,
        211: 129,
        212: 181,
        213: 212,
        214: 207,
        215: 243,
        216: 129,
        217: 41,
        218: 225,
        219: 9,
        220: 109,
        221: 116,
        222: 54,
        223: 124,
        224: 255,
        225: 91,
        226: 43,
        227: 5,
        228: 235,
        229: 77,
        230: 50,
        231: 180,
        232: 33,
        233: 99,
        234: 10,
        235: 127,
        236: 161,
        237: 111,
        238: 42,
        239: 174,
        240: 181,
        241: 223,
        242: 5,
        243: 116,
        244: 193,
        245: 188,
        246: 188,
        247: 233,
        248: 157,
        249: 240,
        250: 185,
        251: 15,
        252: 200,
        253: 32,
        254: 12,
        255: 118,
        256: 203,
        257: 0,
        258: 0,
        259: 125,
        260: 242,
        261: 176,
        262: 139,
        263: 98,
        264: 155,
        265: 173,
        266: 196,
        267: 34,
        268: 78,
        269: 239,
        270: 0,
        271: 0,
        272: 0,
        273: 0,
        274: 1,
        275: 0,
        276: 64,
        277: 55,
        278: 28,
        279: 40,
        280: 150,
        281: 220,
        282: 61,
        283: 0,
        284: 0,
        285: 0,
        286: 0,
        287: 0,
        288: 48,
        289: 175,
        290: 62,
        291: 1,
        292: 0,
        293: 64,
        294: 55,
        295: 28,
        296: 40,
        297: 150,
        298: 220,
        299: 61,
        300: 0,
        301: 0,
        302: 0,
        303: 0,
        304: 168,
        305: 136,
        306: 204,
        307: 165,
        308: 75,
        309: 156,
        310: 103,
        311: 58,
        312: 223,
        313: 41,
        314: 192,
        315: 236,
        316: 203,
        317: 49,
        318: 218,
        319: 171,
        320: 131,
        321: 128,
        322: 51,
        323: 58,
        324: 84,
        325: 7,
        326: 254,
        327: 138,
        328: 11,
        329: 229,
        330: 196,
        331: 146,
        332: 168,
        333: 150,
        334: 13,
        335: 8,
        336: 162,
        337: 220,
        338: 118,
        339: 44,
        340: 124,
        341: 42,
        342: 48,
        343: 120,
        344: 57,
        345: 52,
        346: 51,
        347: 49,
        348: 49,
        349: 48,
        350: 50,
        351: 52,
        352: 49,
        353: 50,
        354: 54,
        355: 54,
        356: 50,
        357: 55,
        358: 53,
        359: 51,
        360: 53,
        361: 53,
        362: 54,
        363: 57,
        364: 48,
        365: 49,
        366: 99,
        367: 100,
        368: 53,
        369: 50,
        370: 98,
        371: 55,
        372: 98,
        373: 48,
        374: 99,
        375: 98,
        376: 56,
        377: 53,
        378: 54,
        379: 97,
        380: 51,
        381: 55,
        382: 100,
        383: 54,
        384: 0,
        385: 0,
        386: 99,
        387: 1,
        388: 0,
        389: 0,
        390: 21,
        391: 1,
        392: 1,
        393: 0,
        394: 32,
        395: 97,
        396: 132,
        397: 159,
        398: 41,
        399: 23,
        400: 117,
        401: 127,
        402: 31,
        403: 79,
        404: 236,
        405: 151,
        406: 246,
        407: 223,
        408: 65,
        409: 57,
        410: 186,
        411: 246,
        412: 106,
        413: 176,
        414: 213,
        415: 226,
        416: 111,
        417: 133,
        418: 59,
        419: 120,
        420: 59,
        421: 45,
        422: 168,
        423: 223,
        424: 245,
        425: 63,
        426: 24,
        427: 115,
        428: 126,
        429: 130,
        430: 31,
        431: 93,
        432: 29,
        433: 207,
        434: 181,
        435: 36,
        436: 116,
        437: 10,
        438: 123,
        439: 58,
        440: 41,
        441: 165,
        442: 56,
        443: 233,
        444: 216,
        445: 193,
        446: 36,
        447: 152,
        448: 50,
        449: 87,
        450: 230,
        451: 170,
        452: 213,
        453: 180,
        454: 208,
        455: 119,
        456: 59,
        457: 182,
        458: 66,
        459: 0,
        460: 0,
        461: 125,
        462: 242,
        463: 176,
        464: 139,
        465: 98,
        466: 155,
        467: 173,
        468: 196,
        469: 34,
        470: 78,
        471: 239,
        472: 0,
        473: 0,
        474: 0,
        475: 0,
        476: 1,
        477: 0,
        478: 64,
        479: 55,
        480: 28,
        481: 40,
        482: 150,
        483: 220,
        484: 61,
        485: 0,
        486: 0,
        487: 0,
        488: 0,
        489: 0,
        490: 48,
        491: 175,
        492: 62,
        493: 1,
        494: 0,
        495: 64,
        496: 55,
        497: 28,
        498: 40,
        499: 150,
        500: 220,
        501: 61,
        502: 0,
        503: 0,
        504: 0,
        505: 0,
        506: 168,
        507: 136,
        508: 204,
        509: 165,
        510: 75,
        511: 83,
        512: 64,
        513: 11,
        514: 83,
        515: 30,
        516: 243,
        517: 107,
        518: 37,
        519: 19,
        520: 33,
        521: 30,
        522: 73,
        523: 64,
        524: 24,
        525: 194,
        526: 251,
        527: 16,
        528: 159,
        529: 190,
        530: 129,
        531: 195,
        532: 59,
        533: 91,
        534: 115,
        535: 151,
        536: 46,
        537: 229,
        538: 132,
        539: 146,
        540: 106,
        541: 115,
        542: 61,
        543: 42,
        544: 48,
        545: 120,
        546: 57,
        547: 52,
        548: 51,
        549: 49,
        550: 49,
        551: 48,
        552: 50,
        553: 52,
        554: 49,
        555: 50,
        556: 54,
        557: 54,
        558: 50,
        559: 55,
        560: 53,
        561: 51,
        562: 53,
        563: 53,
        564: 54,
        565: 57,
        566: 48,
        567: 49,
        568: 99,
        569: 100,
        570: 53,
        571: 50,
        572: 98,
        573: 55,
        574: 98,
        575: 48,
        576: 99,
        577: 98,
        578: 56,
        579: 53,
        580: 54,
        581: 97,
        582: 51,
        583: 55,
        584: 100,
        585: 54,
        586: 0,
        587: 0,
      };
      const blockData = {
        this_block: {
          block_num: 99,
        },
        traces: [
          {
            action_ordinal: 0,
          },
        ],
        block: new Uint8Array(Object.values(jsonBlock)),
      };
      const sr = createStateReceiver();

      const processTrace = jest.fn();
      const processTrace2 = jest.fn();
      sr.registerTraceHandler({
        processTrace,
      });
      sr.registerTraceHandler({
        processTrace: processTrace2,
      });

      await sr.deliverDeserializedBlock(blockData);
      expect(logger.warn).not.toBeCalled();
      expect(processTrace).toBeCalledWith(sr.current_block, blockData.traces, sr.block_time);
      expect(processTrace2).toBeCalledWith(sr.current_block, blockData.traces, sr.block_time);
    });
  });

  describe('onMessage', () => {
    it('first call handle ABI', () => {
      const sr = createStateReceiver();
      const spy_receivedAbi = jest.spyOn(sr, 'receivedAbi').mockImplementation(() => {
        sr.abi = 'abc';
      });
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockImplementation(() => {});
      const spy_processMessageData = jest
        .spyOn(sr, 'processMessageData')
        .mockImplementation(() => {});

      const data = '{ "data": "data" }';
      sr.onMessage(data);

      expect(spy_receivedAbi).toBeCalledWith(data);
      expect(spy_sendAck).not.toBeCalledWith(1);
      expect(spy_processMessageData).not.toBeCalled();
    });
    it('second call handle serialized message', () => {
      const sr = createStateReceiver();
      sr.abi = 'abc';
      const spy_receivedAbi = jest.spyOn(sr, 'receivedAbi').mockImplementation(() => {});
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockImplementation(() => {});
      const spy_processMessageData = jest
        .spyOn(sr, 'processMessageData')
        .mockImplementation(() => {});

      const data = '{ "data": "data" }';

      sr.onMessage(data);

      expect(spy_receivedAbi).not.toBeCalled();
      expect(spy_sendAck).toBeCalledWith(1);
      expect(sr.serializedMessageQueue).toEqual([data]);
      expect(spy_processMessageData).toBeCalledWith(sr.serializedMessageQueue);
    });

    it('handle exception', () => {
      const onError = jest.fn();
      const sr = createStateReceiver({
        onError,
      });
      sr.abi = 'abc';

      const err = new Error('processMessageData-error');

      const spy_onError = jest.spyOn(sr, '_onError');
      const spy_receivedAbi = jest.spyOn(sr, 'receivedAbi').mockImplementation(() => {});
      const spy_sendAck = jest.spyOn(sr, 'sendAck').mockImplementation(() => {});
      const spy_processMessageData = jest.spyOn(sr, 'processMessageData').mockRejectedValue(err);

      const data = '{ "data": "data" }';

      sr.onMessage(data);

      expect(spy_receivedAbi).not.toBeCalled();
      expect(sr.serializedMessageQueue).toEqual([data]);
      expect(spy_processMessageData).toBeCalledWith(sr.serializedMessageQueue);
      expect(spy_sendAck).toBeCalledWith(1);
      // expect(onError).toBeCalledWith(err);
      // expect(spy_onError).toBeCalledWith(err);
    });
  });

  describe('send', () => {
    it('log debug if connection is not established', () => {
      const sr = createStateReceiver();
      sr.send('message');
      expect(serialize).not.toBeCalledWith('message');
      expect(logger.info).toBeCalledWith('Creating eosApi with endpoint: http://localhost:8888');
      expect(logger.warn).toBeCalledWith('Connection is not ready, cannot send message.');
    });

    it('send serialized message', () => {
      const sr = createStateReceiver();
      sr.types = { abi: 'abi' };
      sr.connection = createConnection();
      sr.connection.connected = true;
      serialize.mockReturnValue('serialized message');

      sr.send('message');

      expect(serialize).toBeCalledWith(sr.types, 'request', 'message');
      expect(sr.connection.ws.send).toBeCalledWith('serialized message');
      expect(logger.debug).not.toBeCalled();
    });
  });
});
