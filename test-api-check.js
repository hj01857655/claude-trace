// Test isAnthropicAPI logic
const { getLogger } = require('./dist/interceptor.js');

const logger = getLogger();
if (!logger) {
    console.log('❌ No logger found');
    process.exit(1);
}

console.log('🔍 Testing isAnthropicAPI logic...\n');

// Check environment variables
console.log('📍 Environment variables:');
console.log('  CLAUDE_TRACE_API_ENDPOINT:', process.env.CLAUDE_TRACE_API_ENDPOINT);
console.log('  CLAUDE_TRACE_MESSAGES_PATH:', process.env.CLAUDE_TRACE_MESSAGES_PATH);
console.log('  CLAUDE_TRACE_INCLUDE_ALL_REQUESTS:', process.env.CLAUDE_TRACE_INCLUDE_ALL_REQUESTS);

// Test URLs
const testUrls = [
    'https://api.anthropic.com/v1/messages',
    'https://127.0.0.1:8765/v1/messages',
    'http://127.0.0.1:8765/v1/messages',
    'https://api.anthropic.com/v1/complete',
    'https://127.0.0.1:8765/v1/complete',
];

console.log('\n🧪 Testing URLs:');
testUrls.forEach(url => {
    const result = logger.isAnthropicAPI(url);
    console.log(`  ${result ? '✅' : '❌'} ${url}`);
});

// Test with actual fetch to see what happens
console.log('\n🌐 Making actual fetch request...');
async function test() {
    try {
        const url = 'https://127.0.0.1:8765/v1/messages';
        console.log('📍 Fetching:', url);
        console.log('📍 Should be intercepted:', logger.isAnthropicAPI(url));

        await fetch(url, {
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
