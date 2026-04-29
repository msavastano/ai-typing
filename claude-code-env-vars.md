# Claude Code Environment Variables Reference

## Display & UI

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_NO_FLICKER` | Fullscreen rendering, reduces visual jitter | `1` |
| `CLAUDE_CODE_SCROLL_SPEED` | Wheel scroll multiplier (fullscreen mode) | `1`-`20` |
| `CLAUDE_CODE_DISABLE_MOUSE` | Disable mouse in fullscreen mode | `1` |
| `CLAUDE_CODE_ACCESSIBILITY` | Accessibility mode | `1` |
| `CLAUDE_CODE_SYNTAX_HIGHLIGHT` | Syntax highlighting | `false` to disable |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | Disable title bar updates | `1` |

## Thinking & Reasoning

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_EFFORT_LEVEL` | Set effort level | `low`, `medium`, `high`, `max`, `auto` |
| `CLAUDE_CODE_DISABLE_THINKING` | Disable extended thinking | `1` |
| `MAX_THINKING_TOKENS` | Thinking budget | Token count (integer) |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | Disable adaptive reasoning | `1` |
| `DISABLE_INTERLEAVED_THINKING` | Disable interleaved thinking beta | `1` |

## Model Configuration

| Variable | Purpose | Values |
|----------|---------|--------|
| `ANTHROPIC_MODEL` | Primary model override | Model ID string |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Subagent model | Model ID string |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus model override | Model ID |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet model override | Model ID |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku model override | Model ID |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | Custom model in picker | Model ID |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | Display name for custom model | Display text |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION` | Description for custom model | Description text |

## Memory & Context

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable auto memory | `1` to disable, `0` to force enable |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | Disable CLAUDE.md loading | `1` |
| `CLAUDE_CODE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | Load CLAUDE.md from `--add-dir` | `1` |
| `DISABLE_AUTO_COMPACT` | Disable auto-compaction | `1` |
| `DISABLE_COMPACT` | Disable all compaction | `1` |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | Compaction trigger percentage | `1`-`100` (default ~95) |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Context window for compaction | Token count (integer) |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | File read token limit | Token count (integer) |

## Performance & Timeouts

| Variable | Purpose | Default |
|----------|---------|---------|
| `API_TIMEOUT_MS` | API request timeout | `600000` (10 min) |
| `BASH_DEFAULT_TIMEOUT_MS` | Bash command timeout | — |
| `BASH_MAX_TIMEOUT_MS` | Maximum bash timeout | — |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | Stream idle timeout | `90000` (90 sec) |
| `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` | Glob tool timeout | `20` (60 on WSL) |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | Parallel tool limit | `10` |
| `CLAUDE_CODE_MAX_RETRIES` | Retry attempts | `10` |

## Tool & Feature Control

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_ENABLE_TASKS` | Enable task tracking | `1` |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | Enable PowerShell tool | `1` |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | Disable fast mode | `1` |
| `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` | Disable `/rewind` | `1` |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Disable background tasks | `1` |
| `CLAUDE_CODE_AUTO_BACKGROUND_TASKS` | Force auto-backgrounding | `1` |
| `CLAUDE_CODE_DISABLE_CRON` | Disable scheduled tasks | `1` |
| `CLAUDE_CODE_DISABLE_ATTACHMENTS` | Disable file attachments | `1` |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | Remove git instructions from prompt | `1` |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | Prompt suggestions | `false` to disable |
| `ENABLE_TOOL_SEARCH` | MCP tool search control | `true`, `auto`, `auto:N`, `false` |

## Authentication & API

| Variable | Purpose | Values |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | API key for Anthropic | Key string |
| `ANTHROPIC_AUTH_TOKEN` | Custom Authorization header | Token string |
| `ANTHROPIC_BASE_URL` | Override API endpoint (proxy/gateway) | URL |
| `ANTHROPIC_BETAS` | Comma-separated beta header values | Beta feature names |
| `ANTHROPIC_CUSTOM_HEADERS` | Custom request headers | `Name: Value`, newline-separated |

## Cloud Providers

### Amazon Bedrock

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_USE_BEDROCK` | Enable Bedrock | `1` |
| `ANTHROPIC_BEDROCK_BASE_URL` | Override Bedrock endpoint | URL |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key | Token string |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | Skip AWS auth | `1` |
| `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` | Override AWS region | Region name |

### Google Vertex AI

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_USE_VERTEX` | Enable Vertex | `1` |
| `ANTHROPIC_VERTEX_BASE_URL` | Override Vertex endpoint | URL |
| `ANTHROPIC_VERTEX_PROJECT_ID` | GCP project ID (required) | Project ID |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | Skip Google auth | `1` |

### Microsoft Foundry

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_USE_FOUNDRY` | Enable Foundry | `1` |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Full Foundry resource URL | URL |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Foundry resource name | Resource name |
| `ANTHROPIC_FOUNDRY_API_KEY` | Foundry API key | Key string |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | Skip Azure auth | `1` |

## Telemetry & Privacy

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable all telemetry/analytics at once | `1` |
| `DISABLE_TELEMETRY` | Disable Statsig telemetry | `1` |
| `DISABLE_ERROR_REPORTING` | Disable Sentry reporting | `1` |
| `DISABLE_FEEDBACK_SURVEY` | Disable quality surveys | `1` |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Enable OpenTelemetry | `1` |
| `CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS` | OTel flush timeout | ms (default `5000`) |
| `CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS` | OTel shutdown timeout | ms (default `2000`) |

## Shell & Bash

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_SHELL` | Override shell detection | `bash`, `zsh` |
| `CLAUDE_CODE_SHELL_PREFIX` | Command prefix wrapper | Path to script |
| `CLAUDE_CODE_GIT_BASH_PATH` | Windows Git Bash path | Path to `bash.exe` |
| `BASH_MAX_OUTPUT_LENGTH` | Max bash output characters | Integer |
| `CLAUDE_CODE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | Return to original dir after commands | `1` |

## Configuration & Storage

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CONFIG_DIR` | Config directory override | Path (default `~/.claude`) |
| `CLAUDE_CODE_TMPDIR` | Temp directory override | Path |
| `CLAUDE_CODE_DEBUG_LOGS_DIR` | Debug log file path | Path |
| `CLAUDE_CODE_DEBUG_LOG_LEVEL` | Log level | `verbose`, `debug`, `info`, `warn`, `error` |

## Caching & Optimization

| Variable | Purpose | Values |
|----------|---------|--------|
| `DISABLE_PROMPT_CACHING` | Disable all prompt caching | `1` |
| `DISABLE_PROMPT_CACHING_OPUS` | Disable Opus caching | `1` |
| `DISABLE_PROMPT_CACHING_SONNET` | Disable Sonnet caching | `1` |
| `DISABLE_PROMPT_CACHING_HAIKU` | Disable Haiku caching | `1` |
| `ENABLE_PROMPT_CACHING_1H_BEDROCK` | 1-hour cache for Bedrock | `1` |

## IDE Integration

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_AUTO_CONNECT_IDE` | IDE auto-connect | `true`, `false` |
| `CLAUDE_CODE_IDE_HOST_OVERRIDE` | IDE host address | Host/IP |
| `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL` | Skip extension auto-install | `1` |

## Security & Restrictions

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | Strip credentials from subprocesses | `1` |
| `CLAUDE_CODE_CLIENT_CERT` | Client certificate path | File path |
| `CLAUDE_CODE_CLIENT_KEY` | Client private key path | File path |
| `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` | Key passphrase | String |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` | Allow proxy DNS resolution | `1` |

## OAuth & Sessions

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth access token | Token string |
| `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` | OAuth refresh token | Token string |
| `CLAUDE_CODE_OAUTH_SCOPES` | OAuth scopes | Space-separated scopes |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` | Credential refresh interval | ms (integer) |

## Advanced / Experimental

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Enable agent teams | `1` |
| `CLAUDE_CODE_TEAM_NAME` | Agent team name | String |
| `CLAUDE_CODE_TASK_LIST_ID` | Shared task list ID | ID string |
| `CLAUDE_CODE_SIMPLE` | Minimal system prompt | `1` |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output token limit | Integer |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` | Resume mid-turn after crash | `1` |
| `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` | Auto-exit delay | ms (integer) |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | Strip beta headers | `1` |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | Enable claude.ai MCP servers | `false` to disable |
| `FALLBACK_FOR_ALL_PRIMARY_MODELS` | Fallback on overload | Any non-empty value |

## File Operations

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_CODE_GLOB_HIDDEN` | Include dotfiles in glob | `false` to exclude |
| `CLAUDE_CODE_GLOB_NO_IGNORE` | Ignore .gitignore in glob | `false` to respect |

## Hooks & Environment

| Variable | Purpose | Values |
|----------|---------|--------|
| `CLAUDE_ENV_FILE` | Environment persistence script | File path |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | SessionEnd hooks timeout | ms (default `1500`) |

## Update & Command Control

| Variable | Purpose | Values |
|----------|---------|--------|
| `DISABLE_AUTOUPDATER` | Disable auto-updates | `1` |
| `DISABLE_UPGRADE_COMMAND` | Hide `/upgrade` command | `1` |
| `DISABLE_LOGIN_COMMAND` | Hide `/login` command | `1` |
| `DISABLE_LOGOUT_COMMAND` | Hide `/logout` command | `1` |
| `DISABLE_DOCTOR_COMMAND` | Hide `/doctor` command | `1` |
| `DISABLE_FEEDBACK_COMMAND` | Disable `/feedback` | `1` |
| `DISABLE_COST_WARNINGS` | Disable cost warnings | `1` |

## Networking

| Variable | Purpose | Values |
|----------|---------|--------|
| `HTTP_PROXY` | HTTP proxy server | URL |
| `HTTPS_PROXY` | HTTPS proxy server | URL |

---

## How to Set Environment Variables

**Per-session (inline):**

```bash
CLAUDE_CODE_NO_FLICKER=1 CLAUDE_CODE_EFFORT_LEVEL=max claude
```

**Per-session (export):**

```bash
export CLAUDE_CODE_NO_FLICKER=1
export CLAUDE_CODE_EFFORT_LEVEL=max
claude
```

**Persistent via `~/.claude/settings.json`:**

```json
{
  "env": {
    "CLAUDE_CODE_NO_FLICKER": "1",
    "CLAUDE_CODE_EFFORT_LEVEL": "max"
  }
}
```
