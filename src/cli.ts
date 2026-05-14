#!/usr/bin/env node

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { HTMLGenerator } from "./html-generator";

// Colors for output
export const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[1;33m",
	blue: "\x1b[0;34m",
	reset: "\x1b[0m",
} as const;

type ColorName = keyof typeof colors;

function log(message: string, color: ColorName = "reset"): void {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelp(): void {
	console.log(`
${colors.blue}Claude Trace${colors.reset}
Record all your interactions with Claude Code as you develop your projects

${colors.yellow}USAGE:${colors.reset}
  claude-trace [OPTIONS] [--run-with CLAUDE_ARG...]

${colors.yellow}OPTIONS:${colors.reset}
  --extract-token    Extract OAuth token and exit (reproduces claude-token.py)
  --generate-html    Generate HTML report from JSONL file
  --index           Generate conversation summaries and index for .claude-trace/ directory
  --run-with         Pass all following arguments to Claude process
  --include-all-requests Include all requests made through fetch, otherwise only requests to v1/messages with more than 2 messages in the context
  --no-open          Don't open generated HTML file in browser (works with --generate-html)
  --help, -h         Show this help message

${colors.yellow}MODES:${colors.reset}
  ${colors.green}Interactive logging:${colors.reset}
    claude-trace                               Start Claude with traffic logging
    claude-trace --run-with chat                    Run Claude with specific command
    claude-trace --run-with chat --model sonnet-3.5 Run Claude with multiple arguments

  ${colors.green}Token extraction:${colors.reset}
    claude-trace --extract-token               Extract OAuth token for SDK usage

  ${colors.green}HTML generation:${colors.reset}
    claude-trace --generate-html file.jsonl          Generate HTML from JSONL file
    claude-trace --generate-html file.jsonl out.html Generate HTML with custom output name
    claude-trace --generate-html file.jsonl          Generate HTML and open in browser (default)
    claude-trace --generate-html file.jsonl --no-open Generate HTML without opening browser

  ${colors.green}Indexing:${colors.reset}
    claude-trace --index                             Generate conversation summaries and index

${colors.yellow}EXAMPLES:${colors.reset}
  # Start Claude with logging
  claude-trace

  # Run Claude chat with logging
  claude-trace --run-with chat

  # Run Claude with specific model
  claude-trace --run-with chat --model sonnet-3.5

  # Pass multiple arguments to Claude
  claude-trace --run-with --model gpt-4o --temperature 0.7

  # Extract token for Anthropic SDK
  export ANTHROPIC_API_KEY=$(claude-trace --extract-token)

  # Generate HTML report
  claude-trace --generate-html logs/traffic.jsonl report.html

  # Generate HTML report and open in browser (default)
  claude-trace --generate-html logs/traffic.jsonl

  # Generate HTML report without opening browser
  claude-trace --generate-html logs/traffic.jsonl --no-open

  # Generate conversation index
  claude-trace --index

${colors.yellow}OUTPUT:${colors.reset}
  Logs are saved to: ${colors.green}.claude-trace/log-YYYY-MM-DD-HH-MM-SS.{jsonl,html}${colors.reset}

${colors.yellow}MIGRATION:${colors.reset}
  This tool replaces Python-based claude-logger and claude-token.py scripts
  with a pure Node.js implementation. All output formats are compatible.

For more information, visit: https://github.com/mariozechner/claude-trace
`);
}

/** Check if a file path points to a JavaScript entry point */
function isJsEntryPoint(filePath: string): boolean {
	return /\.(js|mjs|cjs)$/i.test(filePath);
}

/** Check if the resolved claude path is a native binary (not a JS file) */
function isNativeBinary(claudePath: string): boolean {
	if (isJsEntryPoint(claudePath)) return false;
	// On Unix, the file might be a JS script without extension (with shebang)
	if (process.platform !== "win32") {
		try {
			const head = fs.readFileSync(claudePath, "utf-8").slice(0, 256);
			if (head.startsWith("#!") && (head.includes("node") || head.includes("bun") || head.includes("tsx"))) {
				return false; // It's a script with shebang
			}
		} catch (e) {
			// Binary file - readFileSync with utf-8 may still work but content will be garbled
		}
	}
	return true;
}

/** Try to find a JS entry point for Claude Code in the npm global directory */
function resolveClaudeJsEntry(npmBinDir: string): string | null {
	const packageDir = path.join(npmBinDir, "node_modules", "@anthropic-ai", "claude-code");

	if (!fs.existsSync(packageDir)) return null;

	// Check package.json for main/bin JS entries
	try {
		const pkgJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));

		if (pkgJson.main && isJsEntryPoint(pkgJson.main)) {
			const mainPath = path.join(packageDir, pkgJson.main);
			if (fs.existsSync(mainPath)) return mainPath;
		}

		if (pkgJson.bin) {
			const binEntries = typeof pkgJson.bin === "string" ? [pkgJson.bin] : Object.values(pkgJson.bin) as string[];
			for (const entry of binEntries) {
				if (isJsEntryPoint(entry)) {
					const binPath = path.join(packageDir, entry);
					if (fs.existsSync(binPath)) return binPath;
				}
			}
		}
	} catch (e) {}

	// Check common JS entry points
	const candidates = ["cli.js", "index.js", "dist/cli.js", "dist/index.js", "bin/claude.js", "src/cli.js"];
	for (const candidate of candidates) {
		const candidatePath = path.join(packageDir, candidate);
		if (fs.existsSync(candidatePath)) return candidatePath;
	}

	return null;
}

function getClaudeAbsolutePath(): string {
	const isWindows = process.platform === "win32";

	try {
		const cmd = isWindows ? "where claude" : "which claude";
		const lines = require("child_process")
			.execSync(cmd, {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			})
			.trim()
			.split(/\r?\n/)
			.map((l: string) => l.trim())
			.filter((l: string) => l.length > 0);

		if (isWindows) {
			// On Windows, 'where' may return multiple results (e.g., .exe, .cmd, Unix wrapper).
			// Priority: JS entry from npm package > .exe > .cmd > first result

			// 1. Check if any result is directly a JS file
			const jsPath = lines.find((p: string) => isJsEntryPoint(p));
			if (jsPath) return jsPath;

			// 2. Try to resolve JS entry from npm package via .cmd wrapper
			const cmdPath = lines.find((p: string) => p.endsWith(".cmd"));
			if (cmdPath) {
				const npmDir = path.dirname(cmdPath);
				const jsEntry = resolveClaudeJsEntry(npmDir);
				if (jsEntry) return jsEntry;
			}

			// 3. Fallback to .exe (will use native binary spawning)
			const exePath = lines.find((p: string) => p.endsWith(".exe"));
			if (exePath) return exePath;

			// 4. Last resort
			return lines[0];
		}

		return lines[0];
	} catch (error) {
		const os = require("os");
		const localClaudePath = path.join(os.homedir(), ".claude", "local", "node_modules", ".bin", "claude");

		if (fs.existsSync(localClaudePath)) {
			return localClaudePath;
		}

		// On Windows, also check common npm global paths
		if (isWindows) {
			const npmGlobalPaths = [
				path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
				path.join(process.env.LOCALAPPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
			];
			for (const p of npmGlobalPaths) {
				if (fs.existsSync(p)) return p;
			}
		}

		log(`❌ Claude CLI not found in PATH`, "red");
		log(`❌ Also checked for local installation at: ${localClaudePath}`, "red");
		log(`❌ Please install Claude Code CLI first`, "red");
		process.exit(1);
	}
}

function getLoaderPath(): string {
	const loaderPath = path.join(__dirname, "interceptor-loader.js");

	if (!fs.existsSync(loaderPath)) {
		log(`❌ Interceptor loader not found at: ${loaderPath}`, "red");
		process.exit(1);
	}

	return loaderPath;
}

/**
 * Spawn Claude with interception.
 * - For JS entry points: use `node --require interceptor claudePath`
 * - For native binaries: spawn directly with NODE_OPTIONS for interception
 */
function spawnClaudeProcess(
	claudePath: string,
	loaderOrExtractorPath: string,
	claudeArgs: string[],
	extraEnv: Record<string, string>,
): ChildProcess {
	const native = isNativeBinary(claudePath);

	if (native) {
		log(`ℹ️  Native binary detected: ${path.basename(claudePath)}`, "yellow");

		// For native binaries, spawn directly.
		// Set NODE_OPTIONS to inject the interceptor (works for Node.js SEA binaries).
		// For Bun-compiled binaries, NODE_OPTIONS is ignored but won't cause errors.
		return spawn(claudePath, claudeArgs, {
			env: {
				...process.env,
				...extraEnv,
				NODE_OPTIONS: `--require "${loaderOrExtractorPath}" --no-deprecation`,
			},
			stdio: "inherit",
			cwd: process.cwd(),
			shell: process.platform === "win32",
		});
	} else {
		// JS entry point - use node --require (original approach)
		const spawnArgs = ["--require", loaderOrExtractorPath, claudePath, ...claudeArgs];
		return spawn("node", spawnArgs, {
			env: {
				...process.env,
				...extraEnv,
				NODE_OPTIONS: "--no-deprecation",
			},
			stdio: "inherit",
			cwd: process.cwd(),
		});
	}
}

// Scenario 1: No args -> launch node with interceptor and absolute path to claude
async function runClaudeWithInterception(
	claudeArgs: string[] = [],
	includeAllRequests: boolean = false,
	openInBrowser: boolean = false,
): Promise<void> {
	log("🚀 Claude Trace", "blue");
	log("Starting Claude with traffic logging", "yellow");
	if (claudeArgs.length > 0) {
		log(`🔧 Claude arguments: ${claudeArgs.join(" ")}`, "blue");
	}
	console.log("");

	const claudePath = getClaudeAbsolutePath();
	const loaderPath = getLoaderPath();

	log("🔄 Starting traffic logger...", "green");
	log("📁 Logs will be written to: .claude-trace/log-YYYY-MM-DD-HH-MM-SS.{jsonl,html}", "blue");
	console.log("");

	const child = spawnClaudeProcess(claudePath, loaderPath, claudeArgs, {
		CLAUDE_TRACE_INCLUDE_ALL_REQUESTS: includeAllRequests ? "true" : "false",
		CLAUDE_TRACE_OPEN_BROWSER: openInBrowser ? "true" : "false",
	});

	// Handle child process events
	child.on("error", (error: Error) => {
		log(`❌ Error starting Claude: ${error.message}`, "red");
		process.exit(1);
	});

	child.on("exit", (code: number | null, signal: string | null) => {
		if (signal) {
			log(`\n🔄 Claude terminated by signal: ${signal}`, "yellow");
		} else if (code !== 0 && code !== null) {
			log(`\n⚠️  Claude exited with code: ${code}`, "yellow");
		} else {
			log("\n✅ Claude session completed", "green");
		}
	});

	// Handle our own signals
	const handleSignal = (signal: string) => {
		log(`\n🔄 Received ${signal}, shutting down...`, "yellow");
		if (child.pid) {
			child.kill(signal as NodeJS.Signals);
		}
	};

	process.on("SIGINT", () => handleSignal("SIGINT"));
	process.on("SIGTERM", () => handleSignal("SIGTERM"));

	// Wait for child process to complete
	try {
		await new Promise<void>((resolve, reject) => {
			child.on("exit", () => resolve());
			child.on("error", reject);
		});
	} catch (error) {
		const err = error as Error;
		log(`❌ Unexpected error: ${err.message}`, "red");
		process.exit(1);
	}
}

// Scenario 2: --extract-token -> launch node with token interceptor and absolute path to claude
async function extractToken(): Promise<void> {
	const claudePath = getClaudeAbsolutePath();

	// Create .claude-trace directory if it doesn't exist
	const claudeTraceDir = path.join(process.cwd(), ".claude-trace");
	if (!fs.existsSync(claudeTraceDir)) {
		fs.mkdirSync(claudeTraceDir, { recursive: true });
	}

	// Token file location
	const tokenFile = path.join(claudeTraceDir, "token.txt");

	// Use the token extractor directly without copying
	const tokenExtractorPath = path.join(__dirname, "token-extractor.js");
	if (!fs.existsSync(tokenExtractorPath)) {
		log(`❌ Token extractor not found at: ${tokenExtractorPath}`, "red");
		process.exit(1);
	}

	const cleanup = () => {
		try {
			if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile);
		} catch (e) {
			// Ignore cleanup errors
		}
	};

	// Launch claude with token interceptor
	const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;
	const child = spawnClaudeProcess(claudePath, tokenExtractorPath, ["-p", "hello"], {
		NODE_TLS_REJECT_UNAUTHORIZED: "0",
		CLAUDE_TRACE_TOKEN_FILE: tokenFile,
	});

	// Set a timeout to avoid hanging
	const timeout = setTimeout(() => {
		child.kill();
		cleanup();
		console.error("❌ Timeout: No token found within 30 seconds");
		process.exit(1);
	}, 30000);

	// Handle child process events
	child.on("error", (error: Error) => {
		clearTimeout(timeout);
		cleanup();
		console.error(`❌ Error starting Claude: ${error.message}`);
		process.exit(1);
	});

	child.on("exit", () => {
		clearTimeout(timeout);

		try {
			if (fs.existsSync(tokenFile)) {
				const token = fs.readFileSync(tokenFile, "utf-8").trim();
				cleanup();
				if (token) {
					// Only output the token, nothing else
					console.log(token);
					process.exit(0);
				}
			}
		} catch (e) {
			// File doesn't exist or read error
		}

		cleanup();
		console.error("❌ No authorization token found");
		process.exit(1);
	});

	// Check for token file periodically
	const checkToken = setInterval(() => {
		try {
			if (fs.existsSync(tokenFile)) {
				const token = fs.readFileSync(tokenFile, "utf-8").trim();
				if (token) {
					clearTimeout(timeout);
					clearInterval(checkToken);
					child.kill();
					cleanup();

					// Only output the token, nothing else
					console.log(token);
					process.exit(0);
				}
			}
		} catch (e) {
			// Ignore read errors, keep trying
		}
	}, 500);
}

// Scenario 3: --generate-html input.jsonl output.html
async function generateHTMLFromCLI(
	inputFile: string,
	outputFile?: string,
	includeAllRequests: boolean = false,
	openInBrowser: boolean = false,
): Promise<void> {
	try {
		const htmlGenerator = new HTMLGenerator();
		const finalOutputFile = await htmlGenerator.generateHTMLFromJSONL(inputFile, outputFile, includeAllRequests);

		if (openInBrowser) {
			const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
			spawn(openCmd, [finalOutputFile], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
			log(`🌐 Opening ${finalOutputFile} in browser`, "green");
		}

		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`❌ Error: ${err.message}`, "red");
		process.exit(1);
	}
}

// Scenario 4: --index
async function generateIndex(): Promise<void> {
	try {
		const { IndexGenerator } = await import("./index-generator");
		const indexGenerator = new IndexGenerator();
		await indexGenerator.generateIndex();
		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`❌ Error: ${err.message}`, "red");
		process.exit(1);
	}
}

// Main entry point
async function main(): Promise<void> {
	const args = process.argv.slice(2);

	// Split arguments at --run-with flag
	const argIndex = args.indexOf("--run-with");
	let claudeTraceArgs: string[];
	let claudeArgs: string[];

	if (argIndex !== -1) {
		claudeTraceArgs = args.slice(0, argIndex);
		claudeArgs = args.slice(argIndex + 1);
	} else {
		claudeTraceArgs = args;
		claudeArgs = [];
	}

	// Check for help flags
	if (claudeTraceArgs.includes("--help") || claudeTraceArgs.includes("-h")) {
		showHelp();
		process.exit(0);
	}

	// Check for include all requests flag
	const includeAllRequests = claudeTraceArgs.includes("--include-all-requests");

	// Check for no-open flag (inverted logic - open by default)
	const openInBrowser = !claudeTraceArgs.includes("--no-open");

	// Scenario 2: --extract-token
	if (claudeTraceArgs.includes("--extract-token")) {
		await extractToken();
		return;
	}

	// Scenario 3: --generate-html input.jsonl [output.html]
	if (claudeTraceArgs.includes("--generate-html")) {
		const flagIndex = claudeTraceArgs.indexOf("--generate-html");
		const inputFile = claudeTraceArgs[flagIndex + 1];

		// Find the next argument that's not a flag as the output file
		let outputFile: string | undefined;
		for (let i = flagIndex + 2; i < claudeTraceArgs.length; i++) {
			const arg = claudeTraceArgs[i];
			if (!arg.startsWith("--")) {
				outputFile = arg;
				break;
			}
		}

		if (!inputFile) {
			log(`❌ Missing input file for --generate-html`, "red");
			log(`Usage: claude-trace --generate-html input.jsonl [output.html]`, "yellow");
			process.exit(1);
		}

		await generateHTMLFromCLI(inputFile, outputFile, includeAllRequests, openInBrowser);
		return;
	}

	// Scenario 4: --index
	if (claudeTraceArgs.includes("--index")) {
		await generateIndex();
		return;
	}

	// Scenario 1: No args (or claude with args) -> launch claude with interception
	await runClaudeWithInterception(claudeArgs, includeAllRequests, openInBrowser);
}

main().catch((error) => {
	const err = error as Error;
	log(`❌ Unexpected error: ${err.message}`, "red");
	process.exit(1);
});
