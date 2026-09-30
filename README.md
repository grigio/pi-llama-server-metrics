# pi-llama-server-metrics

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that polls a local
[llama.cpp](https://github.com/ggml-org/llama.cpp) server and shows live metrics in the
pi status bar: throughput, token counts, speculative-decoding acceptance, and load.

## Status bar output

```
🐉 Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp 7.4 t/s 11.8k tok spec 52% ctx 22165
```

| Part      | Source metric(s)                                        | Meaning                              |
| --------- | ------------------------------------------------------- | ------------------------------------ |
| `t/s`     | `tokens_predicted_total` / `tokens_predicted_seconds_total` | average decode throughput since load |
| `tok`     | `tokens_predicted_total`                                | total predicted tokens               |
| `spec %`  | `spec_decode_num_accepted_tokens_total` / `..._draft_tokens_total` | draft acceptance rate        |
| `ctx`     | `n_tokens_max`                                          | context tokens in use                |
| `busy:N`  | `requests_processing` + `requests_deferred`             | requests currently in flight         |

When no model is loaded the bar shows `🐉 no model loaded`; when the server is
unreachable it shows `🐉 llama-server unreachable`.

## Requirements

- A running `llama-server` with the `--metrics` flag (e.g. a preset server).
- The server must expose the `/v1/models` and `/metrics` endpoints.

The extension works best with a
[llama.cpp preset server](https://github.com/ggml-org/llama.cpp) (`--models-preset`),
which auto-loads models on demand and reports per-model metrics.

## Install

```sh
pi install git:github.com/grigio/pi-llama-server-metrics
```

Or from a local directory:

```sh
pi install /path/to/pi-llama-server-metrics
```

## Configuration

All options are environment variables, read when the extension loads:

| Variable                   | Default             | Description              |
| -------------------------- | ------------------- | ------------------------ |
| `LLAMA_METRICS_URL`        | `http://127.0.0.1:8080` | llama-server base URL |
| `LLAMA_METRICS_INTERVAL_MS`| `5000`              | poll interval            |
| `LLAMA_METRICS_TIMEOUT_MS` | `3000`              | timeout per HTTP request |

Example:

```sh
LLAMA_METRICS_URL=http://127.0.0.1:59181 LLAMA_METRICS_INTERVAL_MS=2000 pi
```

## How it works

Every `LLAMA_METRICS_INTERVAL_MS` the extension:

1. `GET /v1/models` — finds the first model whose status is `loaded`.
2. `GET /metrics?model=<id>` — parses the Prometheus-style text metrics.
3. Renders a compact, themed status line via `ctx.ui.setStatus`.

Both requests are guarded by a timeout (llama.cpp's `/metrics` endpoint can block
while no model is loaded), and overlapping polls are skipped, so a slow or hung
server never blocks the pi UI.

## Development

```sh
git clone https://github.com/grigio/pi-llama-server-metrics
cd pi-llama-server-metrics
```

The extension is a single `index.ts` loaded by pi via the `pi.extensions` entry in
`package.json`. No build step or runtime dependency is needed — pi loads it
directly with its bundled TypeScript support. Make sure a llama-server with
`--metrics` is running, then run pi and check the status bar.

## License

MIT
