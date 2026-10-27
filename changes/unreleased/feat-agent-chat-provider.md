- **agent:** added a `ChatProvider` interface and `PROVIDERS` registry (`deepseek` for now),
  with `listModels` (OpenAI-style `GET /models`, falling back to `fallbackModels` on any
  failure) and text attachments (`Attachment`, fenced into the prompt, recorded on the
  transcript's user message so a host can render chips). `createChatClient` now also accepts
  `{ provider, model?, apiKey, ... }`; the existing `{ baseUrl, model }` form and `DEEPSEEK`
  keep working unchanged (#257).
