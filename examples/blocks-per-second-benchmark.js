const StateReceiver = require('../src/state-receiver');

const testDurationSeconds = parseInt(process.env.TEST_DURATION) || 120;
const startBlock = parseInt(process.env.START_BLOCK) || 361314;

const sr = new StateReceiver({
  logger: {
    info: (...m) => console.info(...m),
    debug: () => {}, // Disable debug logging for performance
    warn: (...m) => console.warn(...m),
    error: (...m) => console.error(...m),
  },
  startBlock,
  socketAddresses: [process.env.SOCKET_ADDRESS || 'ws://localhost:8080'],
  eosEndpoint: process.env.EOS_ENDPOINT || 'http://localhost:8888',
  deserializerActions: [
    'eosio.token::transfer',
    'bridge.wax::reqnft',
    'bridge.wax::reqwaxtoeth',
    'bridge.wax::nft2wax',
    'returnvalue::returnint',
    'returnvalue::returnstruct',
    'returnvalue::returnstring',
  ],
  maxQueueSize: 50, // Increased for better throughput
  maxMessagesInFlight: 1000, // Increased for better throughput
  fetchBlockTime: false,
});

let blockCount = 0;
let totalProcessingTime = 0;
let minProcessingTime = Infinity;
let maxProcessingTime = 0;
let testStartTime = Date.now();
let lastReportTime = testStartTime;
let lastReportBlockCount = 0;

const bpsHistory = [];

function calculateStats() {
  const now = Date.now();
  const totalElapsed = (now - testStartTime) / 1000;
  const avgBPS = blockCount / totalElapsed;

  // Instantaneous BPS since last report
  const reportElapsed = (now - lastReportTime) / 1000;
  const blocksInPeriod = blockCount - lastReportBlockCount;
  const instantBPS = blocksInPeriod / reportElapsed;

  bpsHistory.push(instantBPS);

  return {
    totalElapsed,
    avgBPS,
    instantBPS,
    avgProcessingTime: totalProcessingTime / blockCount,
    minProcessingTime,
    maxProcessingTime,
  };
}

// Report progress every 5 seconds
const reportInterval = setInterval(() => {
  const stats = calculateStats();
  const status = sr.status();

  console.log(
    `[${Math.floor(stats.totalElapsed)}s] Instant: ${stats.instantBPS.toFixed(2)} BPS | ` +
      `Avg: ${stats.avgBPS.toFixed(2)} BPS | ` +
      `Queue: ${status.serializedMessageQueueSize} | ` +
      `Blocks: ${blockCount}`
  );

  lastReportTime = Date.now();
  lastReportBlockCount = blockCount;
}, 5000);

sr.registerTraceHandler({
  async processTrace(block_num, traces, block_time, head_block_num, last_irreversible_block_num) {
    const processingStart = Date.now();
    // sleep for 100ms to simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Minimal processing - just count actions for efficiency
    let actionCount = 0;
    traces.forEach(([_traceVersion, traceData]) => {
      actionCount += traceData.action_traces.length;
    });

    const processingTime = Date.now() - processingStart;
    totalProcessingTime += processingTime;
    minProcessingTime = Math.min(minProcessingTime, processingTime);
    maxProcessingTime = Math.max(maxProcessingTime, processingTime);

    blockCount++;
  },
});

sr.onError = (err) => {
  sr.stop();
  console.error(`State receiver stopped due to ERROR:`, err);
  printFinalReport();
  process.exit(1);
};

function printFinalReport() {
  clearInterval(reportInterval);

  const finalStats = calculateStats();
  const minBPS = Math.min(...bpsHistory);
  const maxBPS = Math.max(...bpsHistory);

  console.log('\n=== BLOCKS PER SECOND BENCHMARK REPORT ===');
  console.log(`Test Duration: ${finalStats.totalElapsed.toFixed(2)} seconds`);
  console.log(`Total Blocks Processed: ${blockCount}`);
  console.log(`Average BPS: ${finalStats.avgBPS.toFixed(2)}`);
  console.log(`Min BPS: ${minBPS.toFixed(2)}`);
  console.log(`Max BPS: ${maxBPS.toFixed(2)}`);
  console.log(`Avg Processing Time: ${finalStats.avgProcessingTime.toFixed(2)}ms per block`);
  console.log(`Min Processing Time: ${finalStats.minProcessingTime.toFixed(2)}ms`);
  console.log(`Max Processing Time: ${finalStats.maxProcessingTime.toFixed(2)}ms`);
  console.log(`Start Block: ${startBlock}`);
  console.log(`End Block: ${startBlock + blockCount - 1}`);
  console.log('==========================================\n');
}

console.log(`Starting blocks per second benchmark for ${testDurationSeconds} seconds...`);
console.log(`Socket: ${process.env.SOCKET_ADDRESS || 'ws://localhost:8080'}`);
console.log(`EOS Endpoint: ${process.env.EOS_ENDPOINT || 'http://localhost:8888'}`);
console.log(`Start Block: ${startBlock}`);

sr.start();

// Stop after test duration
setTimeout(() => {
  console.log('\nTest completed. Stopping state receiver...');
  sr.stop();
  printFinalReport();
  process.exit(0);
}, testDurationSeconds * 1000);

// Graceful shutdown on SIGINT
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Stopping state receiver...');
  sr.stop();
  printFinalReport();
  process.exit(0);
});
