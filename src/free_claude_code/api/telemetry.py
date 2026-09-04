"""Telemetry and Real-Time Metrics for Enrutador."""

import time
from collections import deque
from dataclasses import dataclass
from typing import Any


@dataclass
class RequestRecord:
    timestamp: float
    endpoint: str
    model: str
    provider: str
    tokens: int
    duration_ms: float
    status: str


@dataclass
class RouteChangeEvent:
    timestamp: float
    previous_provider: str
    new_provider: str
    reason: str


class TelemetryManager:
    """Tracks CPM, TPM, latency, active routes, and model capabilities."""

    def __init__(self) -> None:
        self.request_history: deque[RequestRecord] = deque(maxlen=200)
        self.route_events: deque[RouteChangeEvent] = deque(maxlen=50)
        self.current_provider: str = "nvidia_nim"
        self.current_model: str = "meta/llama-3.3-70b-instruct"
        self.fallback_provider: str = "open_router"
        self.start_time: float = time.time()
        self.total_requests: int = 0
        self.total_tokens: int = 0
        self.last_active_client: str = "hermes"
        self.last_client_event_time: float = time.time()
        self.client_activity: dict[str, float] = {
            "hermes": time.time(),
            "chatgpt": time.time() - 5,
            "claude": 0.0,
            "api": 0.0,
        }

    def record_request(
        self,
        endpoint: str,
        model: str,
        provider: str,
        tokens: int = 1,
        duration_ms: float = 0.0,
        status: str = "success",
        client: str = "api",
    ) -> None:
        now = time.time()
        self.total_requests += 1
        self.total_tokens += max(1, tokens)
        self.last_active_client = client
        self.last_client_event_time = now
        self.client_activity[client] = now
        self.request_history.append(
            RequestRecord(
                timestamp=now,
                endpoint=endpoint,
                model=model,
                provider=provider,
                tokens=tokens,
                duration_ms=duration_ms,
                status=status,
            )
        )
        if provider and provider != self.current_provider:
            self.set_active_route(provider, model=model, reason="request_routing")

    def set_active_route(
        self, new_provider: str, model: str | None = None, reason: str = "manual"
    ) -> None:
        if new_provider != self.current_provider:
            self.route_events.append(
                RouteChangeEvent(
                    timestamp=time.time(),
                    previous_provider=self.current_provider,
                    new_provider=new_provider,
                    reason=reason,
                )
            )
            self.current_provider = new_provider
        if model:
            self.current_model = model

    def get_requests_per_minute(self) -> float:
        now = time.time()
        one_min_ago = now - 60.0
        recent = [r for r in self.request_history if r.timestamp >= one_min_ago]
        return float(len(recent))

    def get_tokens_per_minute(self) -> int:
        now = time.time()
        one_min_ago = now - 60.0
        recent = [r for r in self.request_history if r.timestamp >= one_min_ago]
        return sum(r.tokens for r in recent)

    def get_average_latency_ms(self) -> float:
        if not self.request_history:
            return 0.0
        recent = list(self.request_history)[-20:]
        latencies = [r.duration_ms for r in recent if r.duration_ms > 0]
        return round(sum(latencies) / len(latencies), 1) if latencies else 0.0

    def get_model_specs(self, model_name: str) -> dict[str, Any]:
        """Return context window and multimodal features for known models."""
        m = model_name.lower()
        # Default specs
        context = "128k"
        multimodal = {
            "vision": False,
            "audio": False,
            "tools": True,
            "reasoning": False,
        }

        if "gemini" in m:
            context = "1M - 2M"
            multimodal["vision"] = True
            multimodal["audio"] = True
            multimodal["reasoning"] = "thinking" in m or "2.5" in m
        elif "gpt-4o" in m or "omni" in m:
            context = "128k"
            multimodal["vision"] = True
            multimodal["audio"] = True
        elif "claude-3-7" in m or "claude-3.7" in m:
            context = "200k"
            multimodal["vision"] = True
            multimodal["reasoning"] = True
        elif "claude-3-5" in m or "sonnet" in m:
            context = "200k"
            multimodal["vision"] = True
        elif "deepseek-r1" in m or "r1" in m:
            context = "64k - 128k"
            multimodal["reasoning"] = True
        elif "qwen" in m and "vl" in m:
            context = "128k"
            multimodal["vision"] = True
        elif "llama-3.3" in m or "llama-3.1" in m:
            context = "128k"
            multimodal["tools"] = True
        elif "llama-3.2" in m and ("11b" in m or "90b" in m):
            context = "128k"
            multimodal["vision"] = True

        return {
            "model": model_name,
            "context_window": context,
            "multimodal": multimodal,
        }

    def get_summary(self) -> dict[str, Any]:
        now = time.time()
        cpm = self.get_requests_per_minute()
        tpm = self.get_tokens_per_minute()
        specs = self.get_model_specs(self.current_model)

        recent_route_change = None
        if self.route_events:
            last_ev = self.route_events[-1]
            if now - last_ev.timestamp < 15.0:  # Fresh route change within 15 seconds
                recent_route_change = {
                    "previous_provider": last_ev.previous_provider,
                    "new_provider": last_ev.new_provider,
                    "reason": last_ev.reason,
                    "seconds_ago": round(now - last_ev.timestamp, 1),
                }

        return {
            "uptime_seconds": int(now - self.start_time),
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "requests_per_minute": cpm,
            "tokens_per_minute": tpm,
            "avg_latency_ms": self.get_average_latency_ms(),
            "current_provider": self.current_provider,
            "current_model": self.current_model,
            "fallback_provider": self.fallback_provider,
            "model_specs": specs,
            "last_active_client": self.last_active_client,
            "seconds_since_client_activity": round(
                now - self.last_client_event_time, 1
            ),
            "client_activity": {
                k: round(now - v, 1) if v > 0 else 99999
                for k, v in self.client_activity.items()
            },
            "recent_route_change": recent_route_change,
            "recent_history": [
                {
                    "timestamp": r.timestamp,
                    "endpoint": r.endpoint,
                    "model": r.model,
                    "provider": r.provider,
                    "tokens": r.tokens,
                    "duration_ms": r.duration_ms,
                    "status": r.status,
                }
                for r in list(self.request_history)[-10:]
            ],
        }


# Global singleton telemetry instance
telemetry = TelemetryManager()
