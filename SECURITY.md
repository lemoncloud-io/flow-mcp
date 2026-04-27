# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email [developer@lemoncloud.io](mailto:developer@lemoncloud.io) with details
3. Include steps to reproduce if possible

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

This project is an MCP server that proxies requests to the Eureka Flows API. Security concerns include:

- API key exposure (keys are passed via environment variables, never logged)
- Input validation (all tool inputs validated via Zod schemas)
- Stdio safety (stdout reserved for JSON-RPC, logs go to stderr)

## Best Practices for Users

- Never commit `.env` files or API keys to version control
- Use environment variables or Claude Desktop's `env` config for credentials
- Rotate API keys regularly
