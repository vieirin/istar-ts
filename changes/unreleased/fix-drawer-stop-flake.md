- **playground:** fixed the agent drawer's "Stop mid-stream" e2e spec racing the mocked DeepSeek
  stream under load; the mock now pauses the stream after enough text has arrived, gated on the
  request's `AbortSignal`, instead of relying on chunk-pacing timing (#251).
