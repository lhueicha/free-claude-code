"""OpenAI Chat Completions API adapter for Hermes, ChatGPT Desktop, and OpenAI clients."""

import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

from free_claude_code.api.telemetry import telemetry
from free_claude_code.core.anthropic.models import (
    Message,
    MessagesRequest,
    MessagesResponse,
)


class ChatMessage(BaseModel):
    role: str
    content: Any
    name: str | None = None


class ChatCompletionsRequest(BaseModel):
    model: str = "claude-3-7-sonnet"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = 4096
    presence_penalty: float | None = None
    frequency_penalty: float | None = None


def openai_to_anthropic_request(
    req: ChatCompletionsRequest,
    override_model: str | None = None,
) -> MessagesRequest:
    """Convert an incoming OpenAI /v1/chat/completions request to Anthropic MessagesRequest."""
    system_parts: list[str] = []
    anthropic_messages: list[Message] = []

    for msg in req.messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and "text" in part:
                        system_parts.append(part["text"])
                    elif isinstance(part, str):
                        system_parts.append(part)
        else:
            # Map roles: 'user', 'assistant'
            mapped_role = "assistant" if role == "assistant" else "user"
            # Keep message content as is or extract text
            msg_content = content if isinstance(content, (str, list)) else str(content)

            anthropic_messages.append(
                Message(
                    role=mapped_role,
                    content=msg_content,
                )
            )

    # Ensure there is at least one message
    if not anthropic_messages:
        anthropic_messages.append(Message(role="user", content="Hello"))

    system_text = "\n\n".join(system_parts) if system_parts else None
    effective_model = override_model if override_model else req.model

    return MessagesRequest(
        model=effective_model,
        messages=anthropic_messages,
        system=system_text,
        stream=req.stream,
        temperature=req.temperature,
        max_tokens=req.max_tokens or 4096,
        top_p=req.top_p,
    )


async def sse_anthropic_to_openai_stream(
    anthropic_stream_response: StreamingResponse,
    model: str,
    completion_id: str,
    start_time: float,
    client: str = "hermes",
) -> AsyncIterator[str]:
    """Translate Anthropic SSE events into OpenAI-compatible SSE events."""
    created_ts = int(time.time())
    total_text = []

    try:
        async for chunk in anthropic_stream_response.body_iterator:
            if isinstance(chunk, (bytes, memoryview)):
                text_chunk = bytes(chunk).decode("utf-8", errors="replace")
            elif isinstance(chunk, str):
                text_chunk = chunk
            else:
                text_chunk = str(chunk)

            # Parse SSE lines
            for line in text_chunk.splitlines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    continue

                try:
                    ev = json.loads(data_str)
                    ev_type = ev.get("type", "")

                    delta_text = ""
                    if ev_type == "content_block_delta":
                        delta_body = ev.get("delta", {})
                        if delta_body.get("type") == "text_delta":
                            delta_text = delta_body.get("text", "")
                    elif ev_type == "message_delta":
                        delta_body = ev.get("delta", {})
                        if "text" in delta_body:
                            delta_text = delta_body["text"]

                    if delta_text:
                        total_text.append(delta_text)
                        chunk_payload = {
                            "id": completion_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": model,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": delta_text},
                                    "finish_reason": None,
                                }
                            ],
                        }
                        yield f"data: {json.dumps(chunk_payload, ensure_ascii=False)}\n\n"

                except Exception:
                    pass

        # Send final stop chunk
        stop_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_ts,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop",
                }
            ],
        }
        yield f"data: {json.dumps(stop_chunk, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

        # Record telemetry
        duration_ms = (time.time() - start_time) * 1000
        telemetry.record_request(
            endpoint="/v1/chat/completions",
            model=model,
            provider=telemetry.current_provider,
            tokens=len("".join(total_text).split()),
            duration_ms=round(duration_ms, 1),
            status="success",
            client=client,
        )

    except Exception as exc:
        logger.error("Error in SSE translation: {}", exc)
        err_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_ts,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": f"\n[Enrutador error: {exc}]"},
                    "finish_reason": "error",
                }
            ],
        }
        yield f"data: {json.dumps(err_chunk)}\n\n"
        yield "data: [DONE]\n\n"


def convert_anthropic_response_to_openai(
    anthropic_resp: Any,
    model: str,
    completion_id: str,
    start_time: float,
    client: str = "hermes",
) -> JSONResponse:
    """Format Anthropic MessagesResponse as OpenAI chat completion JSON."""
    created_ts = int(time.time())
    text_content = ""
    prompt_tokens = 10
    completion_tokens = 10

    if isinstance(anthropic_resp, MessagesResponse):
        # Extract content
        parts = []
        for block in anthropic_resp.content:
            if hasattr(block, "text"):
                parts.append(block.text)
            elif isinstance(block, dict) and "text" in block:
                parts.append(block["text"])
        text_content = "".join(parts)
        if hasattr(anthropic_resp, "usage"):
            prompt_tokens = getattr(anthropic_resp.usage, "input_tokens", 10)
            completion_tokens = getattr(anthropic_resp.usage, "output_tokens", 10)
    elif isinstance(anthropic_resp, JSONResponse):
        # In case it returned JSONResponse
        try:
            body = json.loads(anthropic_resp.body.decode("utf-8"))
            content = body.get("content", [])
            parts = [b.get("text", "") for b in content if isinstance(b, dict)]
            text_content = "".join(parts)
            usage = body.get("usage", {})
            prompt_tokens = usage.get("input_tokens", 10)
            completion_tokens = usage.get("output_tokens", 10)
        except Exception:
            text_content = str(anthropic_resp)
    elif isinstance(anthropic_resp, dict):
        content = anthropic_resp.get("content", [])
        parts = [b.get("text", "") for b in content if isinstance(b, dict)]
        text_content = "".join(parts)
        usage = anthropic_resp.get("usage", {})
        prompt_tokens = usage.get("input_tokens", 10)
        completion_tokens = usage.get("output_tokens", 10)
    else:
        text_content = str(anthropic_resp)

    duration_ms = (time.time() - start_time) * 1000
    telemetry.record_request(
        endpoint="/v1/chat/completions",
        model=model,
        provider=telemetry.current_provider,
        tokens=completion_tokens,
        duration_ms=round(duration_ms, 1),
        status="success",
        client=client,
    )

    openai_payload = {
        "id": completion_id,
        "object": "chat.completion",
        "created": created_ts,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": text_content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }
    return JSONResponse(content=openai_payload)
