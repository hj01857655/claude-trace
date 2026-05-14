// Test script to verify interceptor is working
const { initializeInterceptor, getLogger } = require('./dist/interceptor.js');

console.log('🔍 Testing interceptor...');

// Initialize the interceptor
const logger = initializeInterceptor({
    logDirectory: '.claude-trace',
    enableRealTimeHTML: false,
    logLevel: 'debug'
});

console.log('✅ Interceptor initialized');
console.log('📊 Logger stats:', logger.getStats());

// Test if fetch is instrumented
console.log('🔧 Checking if fetch is instrumented:', typeof global.fetch.__claudeTraceInstrumented);

// Make a test request to Anthropic API (will fail but should be logged)
async function testFetch() {
    console.log('\n🌐 Making test fetch request...');

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
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

        console.log('Response status:', response.status);
    } catch (error) {
        console.log('Expected error (no valid API key):', error.message);
    }

    // Wait a bit for async logging
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n📊 Final logger stats:', logger.getStats());

    // Cleanup
    logger.cleanup();
}

testFetch().catch(console.error);
