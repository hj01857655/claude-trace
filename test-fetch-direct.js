// Test if fetch wrapper is actually in place
console.log('🔍 Direct fetch wrapper test...\n');

// Check if fetch is wrapped
console.log('📍 fetch type:', typeof global.fetch);
console.log('📍 fetch.__claudeTraceInstrumented:', global.fetch.__claudeTraceInstrumented);
console.log('📍 fetch.toString():', global.fetch.toString().substring(0, 200));

// Try to manually trace what happens
const originalFetch = global.fetch;
let interceptorCalled = false;

// Wrap fetch to see if it's called
global.fetch = async function(...args) {
    console.log('\n🎯 OUTER WRAPPER CALLED');
    console.log('🎯 URL:', args[0]);
    console.log('🎯 Calling original fetch...');

    interceptorCalled = true;
    const result = await originalFetch.apply(this, args);

    console.log('🎯 Original fetch returned, status:', result.status);
    return result;
};

async function test() {
    console.log('\n🌐 Making test request...');

    try {
        const response = await fetch('https://127.0.0.1:8765/v1/messages', {
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
        });
        console.log('Response status:', response.status);
    } catch (error) {
        console.log('Expected error:', error.message);
    }

    console.log('\n📊 Interceptor called:', interceptorCalled);

    // Check logger
    const { getLogger } = require('./dist/interceptor.js');
    const logger = getLogger();
    if (logger) {
        console.log('📊 Logger stats:', logger.getStats());
    } else {
        console.log('❌ No logger found');
    }
}

test();
