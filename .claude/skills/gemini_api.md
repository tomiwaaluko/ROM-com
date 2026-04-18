---
name: gemini-api
description: How to use Gemini 2.5 Flash in this project — auth, SDK setup,
  text generation, generation config, and error handling.
---

## Model

```
gemini-2.5-flash-preview-04-17
```

## Auth

Export `GEMINI_API_KEY` before running any service that calls Gemini:

```bash
export GEMINI_API_KEY="your-key-here"
```

The key is read at call time — never hardcode it or commit it.

## Install

```bash
pip install google-generativeai
```

Add to whichever `requirements.txt` owns the calling service (e.g. `photon/requirements.txt`):

```
google-generativeai>=0.8.0
```

## Minimal working example

```python
import os
import google.generativeai as genai

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

model = genai.GenerativeModel("gemini-2.5-flash-preview-04-17")

response = model.generate_content("Say hello.")
print(response.text)
```

## Setting generation_config

Pass a `GenerationConfig` (or plain dict) to control sampling behaviour:

```python
import google.generativeai as genai
from google.generativeai.types import GenerationConfig

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash-preview-04-17",
    generation_config=GenerationConfig(
        temperature=0.4,        # lower = more deterministic; use 0.2–0.5 for clinical messages
        max_output_tokens=256,  # iMessage responses are short; cap tightly
    ),
)

response = model.generate_content("Your prompt here.")
print(response.text)
```

`temperature` and `max_output_tokens` can also be overridden per-call:

```python
response = model.generate_content(
    "Your prompt here.",
    generation_config=GenerationConfig(temperature=0.2, max_output_tokens=128),
)
```

## Error types to catch

All Gemini API errors come from `google.api_core.exceptions`:

```python
from google.api_core import exceptions as google_exceptions

try:
    response = model.generate_content(prompt)
except google_exceptions.InvalidArgument as exc:
    # Bad request — malformed prompt or unsupported parameter
    logger.error("Gemini invalid argument: %s", exc)
except google_exceptions.ResourceExhausted as exc:
    # Rate limit or quota exceeded — back off and retry
    logger.error("Gemini quota exceeded: %s", exc)
except google_exceptions.ServiceUnavailable as exc:
    # Transient outage — safe to retry with exponential backoff
    logger.error("Gemini service unavailable: %s", exc)
except google_exceptions.GoogleAPICallError as exc:
    # Catch-all for any other API-level error
    logger.error("Gemini API error: %s", exc)
```

`GoogleAPICallError` is the base class for all of the above, so it can be used
as a single-branch catch when granularity is not needed.

## Usage in this project

When calling Gemini from `photon/message_gen.py`, always:

1. Prepend `CLINICAL_GUARDRAILS_PREFIX` as the first block of the prompt
   (see `.claude/skills/clinical_prompt_guardrails.md`).
2. Set `max_output_tokens` to ≤ 256 — iMessage responses must stay short.
3. Run output through `validate_llm_output()` before passing to `send_imessage_safe()`.
4. Fall back to `render_template()` if a `GoogleAPICallError` is caught.
