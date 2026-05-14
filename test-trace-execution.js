// Test to see if the interceptor wrapper is actually executing its logic
console.log('🔍 Testing interceptor wrapper execution...\n');

const { getLogger } = require('./dist/interceptor.js');
const logger = getLogger();

if (!logger) {
    console.log('❌ No logger found');
    process.exit(1);
}

console.log('✅ Logger found');
console.log('📍 Logger config:', logger.config);

// Manually call isAnthropicAPI to verify it works
const testUrl = 'https://127.0.0.1:8765/v1/messages';
console.log('\n🧪 Testing isAnthropicAPI:');
console.log('  URL:', testUrl);
console.log('  Result:', logger.isAnthropicAPI(testUrl));

// Get the actual fetch function
const fetchFunc = global.fetch;
console.log('\n📍 Fetch function source (first 500 chars):');
console.log(fetchFunc.toString().substring(0, 500));

// Try to trace through the fetch call step by step
console.log('\n🌐 Making traced fetch call...');

async function test() {
    const url = 'https://127.0.0.1:8765/v1/messages';
    const init = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'test-key'
        },
        body: JSON.stringify({
            model: 'test',
            max_tokens: 1,
            messages: []
        })
    };

    console.log('📍 Before fetch call');
    console.log('📍 Pending requests:', logger.pendingRequests.size);
    console.log('📍 Total pairs:', logger.pairs.length);

    try {
        // Add a breakpoint by patching writePairToLog
        const originalWrite = logger.writePairToLog.bind(logger);
        logger.writePairToLog = async function(pair) {
            console.log('\n🎯 writePairToLog CALLED!');
            console.log('🎯 Pair:', JSON.stringify(pair, null, 2));
            return originalWrite(pair);
        };

        // Also patch the pairs array push
        const originalPush = logger.pairs.push.bind(logger.pairs);
        logger.pairs.push = function(...args) {
            console.log('\n🎯 pairs.push CALLED!');
            console.log('🎯 Adding pair:', JSON.stringify(args[0], null, 2));
            return originalPush(...args);
        };

        const response = await fetch(url, init);
        console.log('\n📍 After fetch call');
        console.log('📍 Response status:', response.status);
    } catch (error) {
        console.log('\n📍 Fetch error:', error.message);
    }

    // Wait for async operations
    await new Promise(r => setTimeout(r, 2000));

    console.log('\n📍 Final state:');
    console.log('📍 Pending requests:', logger.pendingRequests.size);
    console.log('📍 Total pairs:', logger.pairs.length);
    console.log('📍 Stats:', logger.getStats());
}

test();
