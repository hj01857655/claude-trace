// Test to see if the error is thrown before logging happens
console.log('🔍 Testing error handling in interceptor...\n');

const { getLogger } = require('./dist/interceptor.js');
const logger = getLogger();

if (!logger) {
    console.log('❌ No logger found');
    process.exit(1);
}

// Patch the fetch wrapper to add detailed logging
const originalFetch = global.fetch;
global.fetch = async function(input, init = {}) {
    console.log('\n🎯 FETCH WRAPPER ENTRY');
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    console.log('🎯 URL:', url);
    console.log('🎯 isAnthropicAPI:', logger.isAnthropicAPI(url));

    if (!logger.isAnthropicAPI(url)) {
        console.log('🎯 Not Anthropic API, passing through');
        return originalFetch.call(this, input, init);
    }

    console.log('🎯 IS Anthropic API, intercepting...');
    console.log('🎯 Generating request ID...');
    const requestId = logger.generateRequestId();
    console.log('🎯 Request ID:', requestId);

    const requestTimestamp = Date.now();
    console.log('🎯 Parsing request body...');
    const body = await logger.parseRequestBody(init.body);
    console.log('🎯 Body parsed');

    const requestData = {
        timestamp: requestTimestamp / 1000,
        method: init.method || "GET",
        url: url,
        headers: logger.redactSensitiveHeaders(Object.fromEntries(new Headers(init.headers || {}).entries())),
        body: body,
    };

    console.log('🎯 Storing pending request...');
    logger.pendingRequests.set(requestId, requestData);
    console.log('🎯 Pending requests size:', logger.pendingRequests.size);

    try {
        console.log('🎯 Calling original fetch...');
        const response = await originalFetch.call(this, input, init);
        console.log('🎯 Original fetch returned, status:', response.status);

        const responseTimestamp = Date.now();
        console.log('🎯 Cloning response...');
        const clonedResponse = await logger.cloneResponse(response);
        console.log('🎯 Response cloned');

        console.log('🎯 Parsing response body...');
        const responseBodyData = await logger.parseResponseBody(clonedResponse);
        console.log('🎯 Response body parsed');

        const responseData = {
            timestamp: responseTimestamp / 1000,
            status_code: response.status,
            headers: logger.redactSensitiveHeaders(Object.fromEntries(response.headers.entries())),
            ...responseBodyData,
        };

        const pair = {
            request: requestData,
            response: responseData,
            logged_at: new Date().toISOString(),
        };

        console.log('🎯 Removing from pending...');
        logger.pendingRequests.delete(requestId);
        console.log('🎯 Adding to pairs...');
        logger.pairs.push(pair);
        console.log('🎯 Pairs length:', logger.pairs.length);

        console.log('🎯 Writing to log...');
        await logger.writePairToLog(pair);
        console.log('🎯 Written to log');

        if (logger.config.enableRealTimeHTML) {
            console.log('🎯 Generating HTML...');
            await logger.generateHTML();
            console.log('🎯 HTML generated');
        }

        console.log('🎯 Returning response');
        return response;
    } catch (error) {
        console.log('🎯 ERROR in fetch:', error.message);
        console.log('🎯 Error stack:', error.stack);
        logger.pendingRequests.delete(requestId);
        throw error;
    }
};

async function test() {
    console.log('\n🌐 Making test request...\n');

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
        console.log('\n✅ Response received, status:', response.status);
    } catch (error) {
        console.log('\n❌ Fetch failed:', error.message);
    }

    await new Promise(r => setTimeout(r, 1000));

    console.log('\n📊 Final stats:', logger.getStats());
}

test();
