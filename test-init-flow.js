// Test to see why interceptor is initialized twice
console.log('🔍 Testing initialization flow...');

// Clear any existing global logger
delete require.cache[require.resolve('./dist/interceptor.js')];

const interceptorModule = require('./dist/interceptor.js');
console.log('📦 Module loaded');
console.log('📦 globalLogger exists:', interceptorModule.getLogger() !== null);
console.log('📦 fetch instrumented before init:', global.fetch.__claudeTraceInstrumented);

// First initialization
console.log('\n🔧 First initialization...');
const logger1 = interceptorModule.initializeInterceptor({
    logDirectory: '.claude-trace',
    enableRealTimeHTML: false,
});
console.log('✅ First init done');
console.log('📍 fetch instrumented:', global.fetch.__claudeTraceInstrumented);
console.log('📍 Logger instance:', logger1 ? 'exists' : 'null');

// Second initialization (this is what's happening)
console.log('\n🔧 Second initialization...');
const logger2 = interceptorModule.initializeInterceptor({
    logDirectory: '.claude-trace',
    enableRealTimeHTML: false,
});
console.log('✅ Second init done');
console.log('📍 Same logger:', logger1 === logger2);

// Check if fetch wrapper actually works
console.log('\n🧪 Testing fetch wrapper...');
const originalFetch = global.fetch;

// Add a test wrapper to see if our interceptor is in the chain
let wrapperCalled = false;
const testWrapper = global.fetch;
global.fetch = async function(...args) {
    wrapperCalled = true;
    console.log('🎯 Test wrapper called');
    const result = await testWrapper.apply(this, args);
    console.log('🎯 Test wrapper returning');
    return result;
};

async function test() {
    try {
        await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': 'test' },
            body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [] })
        });
    } catch (e) {
        console.log('Expected error');
    }

    await new Promise(r => setTimeout(r, 1000));
    console.log('\n📊 Wrapper called:', wrapperCalled);
    console.log('📊 Pairs logged:', logger1.getStats().totalPairs);
}

test();
