# EOSIO state receiver

![example workflow](https://github.com/worldwide-asset-exchange/eosio-statereceiver/actions/workflows/coverage.yml/badge.svg)
[![codecov](https://codecov.io/gh/worldwide-asset-exchange/eosio-statereceiver/branch/master/graph/badge.svg?token=NROW4EZKDO)](https://codecov.io/gh/worldwide-asset-exchange/eosio-statereceiver)

```js
const StateReceiver = require('@waxio/eosio-statereceiver');

const sr = new StateReceiver({
  startBlock: 200,
  socketAddresses: [process.env.SOCKET_ADDRESS || 'ws://localhost:8080'],
  eosEndpoint: process.env.EOS_ENDPOINT || 'http://localhost:8888',
  deserializerActions: ['eosio.token::transfer'],
});

// sample trace handler
sr.registerTraceHandler({
  contractName: 'eosio.token',
  actionName: 'transfer',
  async processTrace(block_num, traces, block_time) {
    //
  },
});

sr.onError = (err) => {
  sr.stop();
  console.error(`State receiver stop due to ERROR:`, err);
};

sr.start();
```

Example can be found in [state-receiver.js](examples/state-receiver.js).

Running example:

```sh
export SOCKET_ADDRESS=http://localhost:8080
export EOS_ENDPOINT=http://localhost:8888

npm run dev
```

sample working log

```log
$ npm run dev

> @waxio/eosio-statereceiver@2.0.0 dev /home/ubuntu/eosio-statereceiver
> npm run state-receiver


> @waxio/eosio-statereceiver@2.0.0 state-receiver /home/ubuntu/eosio-statereceiver
> node ./examples/state-receiver.js

Creating eosApi with endpoint: http://state-node-host:8888
Websocket connecting to: http://state-node-host:8080
Receiving abi...
Requesting blocks, Start : 20284880, End : 4294967295, Max Messages In Flight : 5
20284884 bridge.wax::nft2wax hg.wam
20284890 bridge.wax::nft2wax hg.wam
Received 918 B/s; Queue size: 20
Received 946.5 B/s; Queue size: 39
25077 returnvalue::returnstruct return value {"value1":"test value1 value1","value2":35594}
25264 returnvalue::returnstring return value "test test action return string"
...
```

## Tuning environment variables

These are all optional. Defaults preserve historical behavior.

| Variable                                    | Default | Purpose                                                                                                                                                                                                 |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAX_STATE_HISTORY_ACK_EACH_BLOCK`          | _unset_ | Set to `1` to send one `get_blocks_ack_request_v0` per processed block (`num_messages: 1`) instead of acking the whole free window. Useful against state-history nodes that misbehave with batched ACK. |
| `WAX_STATE_HISTORY_ACK_BACKPRESSURE_LOG_MS` | `5000`  | Throttle (ms) for the "ACK paused (backpressure)" log emitted when the queue is full. Set `0` to log every occurrence.                                                                                  |
| `WAX_STATE_HISTORY_DRAIN_BACKOFF_MS`        | `250`   | Delay (ms) before re-entering `processMessageData` after an error during drain. Prevents a hot error loop on a malformed/poison block.                                                                  |
| `WAX_STATE_HISTORY_STATS_LOG`               | `on`    | Set to `0`, `false`, or `off` to suppress the rolling sync-stats line (`blocks_per_sec`, `behind_head`, `eta_*`).                                                                                       |
| `WAX_STATE_HISTORY_STATS_INTERVAL_MS`       | `1000`  | Window (ms) over which sync stats are aggregated and emitted.                                                                                                                                           |
| `DEBUG_STATE_RECEIVER`                      | _unset_ | Set to `1` for verbose per-message debug logs.                                                                                                                                                          |
