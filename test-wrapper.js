// Test to check if the wrapper is actually being called
const { initializeInterceptor } = require('./dist/interceptor.js');

console.log('🔍 Testing if fetch wrapper is called...');

// Save original fetch
const trulyOriginalFetch = global.fetch;
console.log('📍 Original fetch:', typeof trulyOriginalFetch);

// Initialize interceptor
const logger = initializeInterceptor({
    logDirectory: '.claude-trace',
    enableRealTimeHTML: false,
});

console.log('✅ Interceptor initialized');
console.log('📍 After init, fetch:', typeof global.fetch);
console.log('📍 fetch === original:', global.fetch === trulyOriginalFetch);
console.log('📍 fetch.__claudeTraceInstrumented:', global.fetch.__claudeTraceInstrumented);

// Manually wrap fetch to see if it gets called
const afterInitFetch = global.fetch;
global.fetch = async function(...args) {
    console.log('🎯 FETCH WRAPPER CALLED!');
    console.log('🎯 Arguments:', args[0]);
    return afterInitFetch.apply(this, args);
};

// Test
async function test() {
    console.log('\n🌐 Making test request...');
    try {
        await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': 'test' },
            body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [] })
        });
    } catch (e) {
        console.log('Expected error:', e.message);
    }

    await new Promise(r => setTimeout(r, 1000));
    console.log('\n📊 Stats:', logger.getStats());
}

test();
