"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeTrafficLogger = void 0;
exports.initializeInterceptor = initializeInterceptor;
exports.getLogger = getLogger;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const html_generator_1 = require("./html-generator");
class ClaudeTrafficLogger {
    constructor(config = {}) {
        this.pendingRequests = new Map();
        this.pairs = [];
        this.config = {
            logDirectory: ".claude-trace",
            enableRealTimeHTML: true,
            logLevel: "info",
            ...config,
        };
        // Create log directory if it doesn't exist
        this.logDir = this.config.logDirectory;
        if (!fs_1.default.existsSync(this.logDir)) {
            fs_1.default.mkdirSync(this.logDir, { recursive: true });
        }
        // Generate timestamped filenames
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, -5); // Remove milliseconds and Z
        this.logFile = path_1.default.join(this.logDir, `log-${timestamp}.jsonl`);
        this.htmlFile = path_1.default.join(this.logDir, `log-${timestamp}.html`);
        // Initialize HTML generator
        this.htmlGenerator = new html_generator_1.HTMLGenerator();
        // Clear log file
        fs_1.default.writeFileSync(this.logFile, "");
    }
    isAnthropicAPI(url) {
        const urlString = typeof url === "string" ? url : url.toString();
        const includeAllRequests = process.env.CLAUDE_TRACE_INCLUDE_ALL_REQUESTS === "true";
        // 从环境变量读取自定义API端点，默认为api.anthropic.com
        const apiEndpoint = process.env.CLAUDE_TRACE_API_ENDPOINT || "api.anthropic.com";
        const messagesPath = process.env.CLAUDE_TRACE_MESSAGES_PATH || "/v1/messages";
        if (includeAllRequests) {
            return urlString.includes(apiEndpoint); // 捕获所有自定义端点的API请求
        }
        return urlString.includes(apiEndpoint) && urlString.includes(messagesPath);
    }
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    redactSensitiveHeaders(headers) {
        const redactedHeaders = { ...headers };
        const sensitiveKeys = [
            "authorization",
            "x-api-key",
            "x-auth-token",
            "cookie",
            "set-cookie",
            "x-session-token",
            "x-access-token",
            "bearer",
            "proxy-authorization",
        ];
        for (const key of Object.keys(redactedHeaders)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
                // Keep first 10 chars and last 4 chars, redact middle
                const value = redactedHeaders[key];
                if (value && value.length > 14) {
                    redactedHeaders[key] = `${value.substring(0, 10)}...${value.slice(-4)}`;
                }
                else if (value && value.length > 4) {
                    redactedHeaders[key] = `${value.substring(0, 2)}...${value.slice(-2)}`;
                }
                else {
                    redactedHeaders[key] = "[REDACTED]";
                }
            }
        }
        return redactedHeaders;
    }
    async cloneResponse(response) {
        // Clone the response to avoid consuming the body
        return response.clone();
    }
    async parseRequestBody(body) {
        if (!body)
            return null;
        if (typeof body === "string") {
            try {
                return JSON.parse(body);
            }
            catch {
                return body;
            }
        }
        if (body instanceof FormData) {
            const formObject = {};
            for (const [key, value] of body.entries()) {
                formObject[key] = value;
            }
            return formObject;
        }
        return body;
    }
    async parseResponseBody(response) {
        const contentType = response.headers.get("content-type") || "";
        try {
            if (contentType.includes("application/json")) {
                const body = await response.json();
                return { body };
            }
            else if (contentType.includes("text/event-stream")) {
                const body_raw = await response.text();
                return { body_raw };
            }
            else if (contentType.includes("text/")) {
                const body_raw = await response.text();
                return { body_raw };
            }
            else {
                // For other types, try to read as text
                const body_raw = await response.text();
                return { body_raw };
            }
        }
        catch (error) {
            // Silent error handling during runtime
            return {};
        }
    }
    instrumentAll() {
        this.instrumentFetch();
        this.instrumentNodeHTTP();
    }
    instrumentFetch() {
        if (!global.fetch) {
            // Silent - fetch not available
            return;
        }
        // Check if already instrumented by checking for our marker
        if (global.fetch.__claudeTraceInstrumented) {
            return;
        }
        const originalFetch = global.fetch;
        const logger = this;
        global.fetch = async function (input, init = {}) {
            // Convert input to URL for consistency
            const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            // Only intercept Anthropic API calls
            if (!logger.isAnthropicAPI(url)) {
                return originalFetch(input, init);
            }
            const requestId = logger.generateRequestId();
            const requestTimestamp = Date.now();
            // Capture request details
            const requestData = {
                timestamp: requestTimestamp / 1000, // Convert to seconds (like Python version)
                method: init.method || "GET",
                url: url,
                headers: logger.redactSensitiveHeaders(Object.fromEntries(new Headers(init.headers || {}).entries())),
                body: await logger.parseRequestBody(init.body),
            };
            // Store pending request
            logger.pendingRequests.set(requestId, requestData);
            try {
                // Make the actual request
                const response = await originalFetch(input, init);
                const responseTimestamp = Date.now();
                // Clone response to avoid consuming the body
                const clonedResponse = await logger.cloneResponse(response);
                // Parse response body
                const responseBodyData = await logger.parseResponseBody(clonedResponse);
                // Create response data
                const responseData = {
                    timestamp: responseTimestamp / 1000,
                    status_code: response.status,
                    headers: logger.redactSensitiveHeaders(Object.fromEntries(response.headers.entries())),
                    ...responseBodyData,
                };
                // Create paired request-response object
                const pair = {
                    request: requestData,
                    response: responseData,
                    logged_at: new Date().toISOString(),
                };
                // Remove from pending and add to pairs
                logger.pendingRequests.delete(requestId);
                logger.pairs.push(pair);
                // Write to log file
                await logger.writePairToLog(pair);
                // Generate HTML if enabled
                if (logger.config.enableRealTimeHTML) {
                    await logger.generateHTML();
                }
                return response;
            }
            catch (error) {
                // Remove from pending requests on error
                logger.pendingRequests.delete(requestId);
                throw error;
            }
        };
        // Mark fetch as instrumented
        global.fetch.__claudeTraceInstrumented = true;
        // Silent initialization
    }
    instrumentNodeHTTP() {
        try {
            const http = require("http");
            const https = require("https");
            const logger = this;
            // Instrument http.request
            if (http.request && !http.request.__claudeTraceInstrumented) {
                const originalHttpRequest = http.request;
                http.request = function (options, callback) {
                    return logger.interceptNodeRequest(originalHttpRequest, options, callback, false);
                };
                http.request.__claudeTraceInstrumented = true;
            }
            // Instrument http.get
            if (http.get && !http.get.__claudeTraceInstrumented) {
                const originalHttpGet = http.get;
                http.get = function (options, callback) {
                    return logger.interceptNodeRequest(originalHttpGet, options, callback, false);
                };
                http.get.__claudeTraceInstrumented = true;
            }
            // Instrument https.request
            if (https.request && !https.request.__claudeTraceInstrumented) {
                const originalHttpsRequest = https.request;
                https.request = function (options, callback) {
                    return logger.interceptNodeRequest(originalHttpsRequest, options, callback, true);
                };
                https.request.__claudeTraceInstrumented = true;
            }
            // Instrument https.get
            if (https.get && !https.get.__claudeTraceInstrumented) {
                const originalHttpsGet = https.get;
                https.get = function (options, callback) {
                    return logger.interceptNodeRequest(originalHttpsGet, options, callback, true);
                };
                https.get.__claudeTraceInstrumented = true;
            }
        }
        catch (error) {
            // Silent error handling
        }
    }
    interceptNodeRequest(originalRequest, options, callback, isHttps) {
        // Parse URL from options
        const url = this.parseNodeRequestURL(options, isHttps);
        if (!this.isAnthropicAPI(url)) {
            return originalRequest.call(this, options, callback);
        }
        const requestId = this.generateRequestId();
        const requestTimestamp = Date.now();
        let requestBody = "";
        // Create the request
        const req = originalRequest.call(this, options, (res) => {
            const responseTimestamp = Date.now();
            let responseBody = "";
            // Capture response data
            res.on("data", (chunk) => {
                responseBody += chunk;
            });
            res.on("end", async () => {
                // Process the captured request/response
                const requestData = {
                    timestamp: requestTimestamp / 1000,
                    method: options.method || "GET",
                    url: url,
                    headers: this.redactSensitiveHeaders(options.headers || {}),
                    body: requestBody ? await this.parseRequestBody(requestBody) : null,
                };
                const responseData = {
                    timestamp: responseTimestamp / 1000,
                    status_code: res.statusCode,
                    headers: this.redactSensitiveHeaders(res.headers || {}),
                    ...(await this.parseResponseBodyFromString(responseBody, res.headers["content-type"])),
                };
                const pair = {
                    request: requestData,
                    response: responseData,
                    logged_at: new Date().toISOString(),
                };
                this.pairs.push(pair);
                await this.writePairToLog(pair);
                if (this.config.enableRealTimeHTML) {
                    await this.generateHTML();
                }
            });
            // Call original callback if provided
            if (callback) {
                callback(res);
            }
        });
        // Capture request body
        const originalWrite = req.write;
        req.write = function (chunk) {
            if (chunk) {
                requestBody += chunk;
            }
            return originalWrite.call(this, chunk);
        };
        return req;
    }
    parseNodeRequestURL(options, isHttps) {
        if (typeof options === "string") {
            return options;
        }
        const protocol = isHttps ? "https:" : "http:";
        const hostname = options.hostname || options.host || "localhost";
        const port = options.port ? `:${options.port}` : "";
        const path = options.path || "/";
        return `${protocol}//${hostname}${port}${path}`;
    }
    async parseResponseBodyFromString(body, contentType) {
        try {
            if (contentType && contentType.includes("application/json")) {
                return { body: JSON.parse(body) };
            }
            else if (contentType && contentType.includes("text/event-stream")) {
                return { body_raw: body };
            }
            else {
                return { body_raw: body };
            }
        }
        catch (error) {
            return { body_raw: body };
        }
    }
    async writePairToLog(pair) {
        try {
            const jsonLine = JSON.stringify(pair) + "\n";
            fs_1.default.appendFileSync(this.logFile, jsonLine);
        }
        catch (error) {
            // Silent error handling during runtime
        }
    }
    async generateHTML() {
        try {
            const includeAllRequests = process.env.CLAUDE_TRACE_INCLUDE_ALL_REQUESTS === "true";
            await this.htmlGenerator.generateHTML(this.pairs, this.htmlFile, {
                title: `${this.pairs.length} API Calls`,
                timestamp: new Date().toISOString().replace("T", " ").slice(0, -5),
                includeAllRequests,
            });
            // Silent HTML generation
        }
        catch (error) {
            // Silent error handling during runtime
        }
    }
    cleanup() {
        console.log("Cleaning up orphaned requests...");
        for (const [, requestData] of this.pendingRequests.entries()) {
            const orphanedPair = {
                request: requestData,
                response: null,
                note: "ORPHANED_REQUEST - No matching response received",
                logged_at: new Date().toISOString(),
            };
            try {
                const jsonLine = JSON.stringify(orphanedPair) + "\n";
                fs_1.default.appendFileSync(this.logFile, jsonLine);
            }
            catch (error) {
                console.log(`Error writing orphaned request: ${error}`);
            }
        }
        this.pendingRequests.clear();
        console.log(`Cleanup complete. Logged ${this.pairs.length} pairs`);
        // Open browser if requested
        const shouldOpenBrowser = process.env.CLAUDE_TRACE_OPEN_BROWSER === "true";
        if (shouldOpenBrowser && fs_1.default.existsSync(this.htmlFile)) {
            try {
                (0, child_process_1.spawn)("open", [this.htmlFile], { detached: true, stdio: "ignore" }).unref();
                console.log(`🌐 Opening ${this.htmlFile} in browser`);
            }
            catch (error) {
                console.log(`❌ Failed to open browser: ${error}`);
            }
        }
    }
    getStats() {
        return {
            totalPairs: this.pairs.length,
            pendingRequests: this.pendingRequests.size,
            logFile: this.logFile,
            htmlFile: this.htmlFile,
        };
    }
}
exports.ClaudeTrafficLogger = ClaudeTrafficLogger;
// Global logger instance
let globalLogger = null;
// Track if event listeners have been set up
let eventListenersSetup = false;
function initializeInterceptor(config) {
    if (globalLogger) {
        console.warn("Interceptor already initialized");
        return globalLogger;
    }
    globalLogger = new ClaudeTrafficLogger(config);
    globalLogger.instrumentAll();
    // Setup cleanup on process exit only once
    if (!eventListenersSetup) {
        const cleanup = () => {
            if (globalLogger) {
                globalLogger.cleanup();
            }
        };
        process.on("exit", cleanup);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("uncaughtException", (error) => {
            console.error("Uncaught exception:", error);
            cleanup();
            process.exit(1);
        });
        eventListenersSetup = true;
    }
    return globalLogger;
}
function getLogger() {
    return globalLogger;
}
//# sourceMappingURL=interceptor.js.map