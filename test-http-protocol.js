// Test with http:// prefix
console.log('🔍 Testing with http:// protocol...\n');

const { getLogger } = require('./dist/interceptor.js');
const logger = getLogger();

if (!logger) {
    console.log('❌ No logger found');
    process.exit(1);
}

console.log('✅ Logger found');
console.log('📍 CLAUDE_TRACE_API_ENDPOINT:', process.env.CLAUDE_TRACE_API_ENDPOINT);

// Test URLs with and without protocol
const testUrls = [
    'http://127.0.0.1:8765/v1/messages',
    'https://127.0.0.1:8765/v1/messages',
    'https://api.anthropic.com/v1/messages',
];

console.log('\n🧪 Testing URL matching:');
testUrls.forEach(url => {
    const result = logger.isAnthropicAPI(url);
    console.log(`  ${result ? '✅' : '❌'} ${url}`);
});

async function test() {
    console.log('\n🌐 Making test request with http://...\n');

    try {
        const response = await fetch('http://127.0.0.1:8765/v1/messages', {
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
        console.log('✅ Response received, status:', response.status);
    } catch (error) {
        console.log('❌ Fetch failed:', error.message);
        console.log('   (This is expected if no server is running on 127.0.0.1:8765)');
    }

    await new Promise(r => setTimeout(r, 1000));

    console.log('\n📊 Final stats:', logger.getStats());

    // Check log file
    const fs = require('fs');
    const logFile = logger.getStats().logFile;
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        console.log('📄 Log file size:', content.length, 'bytes');
        if (content.length > 0) {
            console.log('📄 Log file content:');
            console.log(content);
        }
    }
}

test();
