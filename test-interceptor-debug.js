// Debug test to see what's happening with the interceptor
const { initializeInterceptor, getLogger } = require('./dist/interceptor.js');

console.log('🔍 Testing interceptor with debug output...');

// Initialize the interceptor
const logger = initializeInterceptor({
    logDirectory: '.claude-trace',
    enableRealTimeHTML: false,
    logLevel: 'debug'
});

console.log('✅ Interceptor initialized');

// Patch the logger to add debug output
const originalWritePairToLog = logger.writePairToLog.bind(logger);
logger.writePairToLog = async function(pair) {
    console.log('📝 writePairToLog called with:', JSON.stringify(pair, null, 2));
    return originalWritePairToLog(pair);
};

// Test if fetch is instrumented
const originalFetch = global.fetch;
console.log('🔧 fetch instrumented:', global.fetch.__claudeTraceInstrumented);
console.log('🔧 fetch is same as original:', global.fetch === originalFetch);

// Make a test request
async function testFetch() {
    console.log('\n🌐 Making test fetch request to api.anthropic.com...');

    try {
        const url = 'https://api.anthropic.com/v1/messages';
        console.log('📍 URL:', url);
        console.log('📍 isAnthropicAPI check:', logger.isAnthropicAPI ? 'method exists' : 'method missing');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'test-key',
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 1024,
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            })
        });

        console.log('✅ Response status:', response.status);
        console.log('✅ Response received');
    } catch (error) {
        console.log('❌ Error:', error.message);
    }

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n📊 Final stats:', logger.getStats());
    console.log('📊 Pairs array length:', logger.pairs ? logger.pairs.length : 'undefined');
    console.log('📊 Pending requests:', logger.pendingRequests ? logger.pendingRequests.size : 'undefined');

    // Check log file
    const fs = require('fs');
    const logFile = logger.getStats().logFile;
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        console.log('\n📄 Log file content length:', content.length);
        console.log('📄 Log file content:', content || '(empty)');
    } else {
        console.log('\n❌ Log file does not exist:', logFile);
    }

    logger.cleanup();
}

testFetch().catch(console.error);
