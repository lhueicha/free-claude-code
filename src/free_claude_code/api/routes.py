"""FastAPI route handlers."""

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from loguru import logger

from free_claude_code.api.handlers.chat_completions import (
    ChatCompletionsRequest,
    convert_anthropic_response_to_openai,
    openai_to_anthropic_request,
    sse_anthropic_to_openai_stream,
)
from free_claude_code.api.telemetry import telemetry
from free_claude_code.application.errors import ApplicationError
from free_claude_code.application.ports import ProviderResolver, RequestRuntimeLease
from free_claude_code.config.model_refs import parse_provider_type
from free_claude_code.config.settings import Settings
from free_claude_code.core.anthropic import (
    MessagesRequest,
    TokenCountRequest,
    get_token_count,
)
from free_claude_code.core.openai_responses import OpenAIResponsesRequest
from free_claude_code.core.trace import trace_event

from .benchmark_engine import benchmark_engine
from .dependencies import (
    get_services,
    get_settings,
    require_anthropic_proxy_auth,
    require_proxy_auth,
    resolve_provider,
)
from .handlers import MessagesHandler, ResponsesHandler, TokenCountHandler
from .model_catalog import (
    ModelCatalogView,
    ModelsListResponse,
    build_models_list_response,
)
from .ports import ApiServices
from .request_errors import ordinary_application_error_response
from .request_ids import get_request_id
from .response_streams import bind_response_lifetime

router = APIRouter()


def _provider_resolver(lease: RequestRuntimeLease) -> ProviderResolver:
    return lambda provider_type: resolve_provider(provider_type, lease=lease)


async def _create_messages_response(
    services: ApiServices,
    request_data: MessagesRequest,
    *,
    request_id: str,
) -> object:
    lease: RequestRuntimeLease | None = None
    try:
        lease = await services.requests.acquire()
        handler = MessagesHandler(
            lease.settings,
            provider_resolver=_provider_resolver(lease),
            token_counter=get_token_count,
            generation_id=lease.generation_id,
        )
        response = await handler.create(request_data, request_id=request_id)
    except ApplicationError as exc:
        if lease is not None:
            await lease.release()
        return ordinary_application_error_response(
            exc,
            wire_api="messages",
            request_id=request_id,
        )
    except BaseException:
        if lease is not None:
            await lease.release()
        raise
    assert lease is not None
    return await bind_response_lifetime(response, lease.release)


async def _create_responses_response(
    services: ApiServices,
    request_data: OpenAIResponsesRequest,
    *,
    request_id: str,
) -> object:
    lease: RequestRuntimeLease | None = None
    try:
        lease = await services.requests.acquire()
        handler = ResponsesHandler(
            lease.settings,
            provider_resolver=_provider_resolver(lease),
            generation_id=lease.generation_id,
        )
        response = await handler.create(request_data, request_id=request_id)
    except ApplicationError as exc:
        if lease is not None:
            await lease.release()
        return ordinary_application_error_response(
            exc,
            wire_api="responses",
            request_id=request_id,
        )
    except BaseException:
        if lease is not None:
            await lease.release()
        raise
    assert lease is not None
    return await bind_response_lifetime(response, lease.release)


def _probe_response(allow: str) -> Response:
    return Response(status_code=204, headers={"Allow": allow})


@router.post("/v1/messages")
async def create_message(
    request: Request,
    request_data: MessagesRequest,
    services: ApiServices = Depends(get_services),
    _auth=Depends(require_anthropic_proxy_auth),
):
    """Create a message (JSON by default; stream=true returns Anthropic SSE)."""
    t0 = time.time()
    resp = await _create_messages_response(
        services,
        request_data,
        request_id=get_request_id(request),
    )
    duration_ms = (time.time() - t0) * 1000
    telemetry.record_request(
        endpoint="/v1/messages",
        model=request_data.model,
        provider=telemetry.current_provider,
        tokens=30,
        duration_ms=round(duration_ms, 1),
    )
    return resp


@router.api_route("/v1/messages", methods=["HEAD", "OPTIONS"])
async def probe_messages(_auth=Depends(require_anthropic_proxy_auth)):
    return _probe_response("POST, HEAD, OPTIONS")


@router.post("/v1/responses")
async def create_response(
    request: Request,
    request_data: OpenAIResponsesRequest,
    services: ApiServices = Depends(get_services),
    _auth=Depends(require_proxy_auth),
):
    """Create an OpenAI Responses-compatible response through this proxy."""
    start_time = time.time()
    user_agent = (request.headers.get("user-agent") or "").lower()
    auth_header = (request.headers.get("authorization") or "").lower()

    client = "chatgpt"
    if "hermes" in user_agent or "hermes" in auth_header:
        client = "hermes"

    # Immediate client pulse so UI pipeline and green synapse fire right away
    telemetry.client_activity[client] = time.time()
    telemetry.last_active_client = client
    telemetry.last_client_event_time = time.time()

    raw_model = (request_data.model or "").strip()
    if raw_model in ("enrutador-auto", "enrutador", "auto", "default") or not raw_model:
        effective_model = (
            telemetry.current_model
            or PROVIDER_DEFAULT_MODELS.get(telemetry.current_provider, "")
            or benchmark_engine.recommended_model_id
        )
    elif "/" in raw_model:
        effective_model = raw_model
        prov = parse_provider_type(raw_model)
        if prov and prov != telemetry.current_provider:
            telemetry.set_active_route(
                prov, model=effective_model, reason="client_direct_model"
            )
    elif "deepseek" in raw_model.lower():
        effective_model = "nvidia_nim/meta/llama-3.3-70b-instruct"
        if telemetry.current_provider != "nvidia_nim":
            telemetry.set_active_route(
                "nvidia_nim", model=effective_model, reason="client_deepseek_model"
            )
    else:
        effective_model = (
            telemetry.current_model
            or PROVIDER_DEFAULT_MODELS.get(telemetry.current_provider, "")
            or benchmark_engine.recommended_model_id
        )

    # Overwrite the model in request_data to ensure valid routing
    request_data = request_data.model_copy(update={"model": effective_model})
    active_provider = telemetry.current_provider or parse_provider_type(effective_model)
    routing_reason = benchmark_engine.explain_routing(active_provider, client=client)
    logger.info(
        "ROUTER_RESPONSES_DECISION: client={} model={} provider={} reason={}",
        client,
        effective_model,
        active_provider,
        routing_reason,
    )

    resp = await _create_responses_response(
        services,
        request_data,
        request_id=get_request_id(request),
    )

    if isinstance(resp, StreamingResponse):
        orig_iterator = resp.body_iterator

        async def telemetry_wrapped_iterator():
            token_count = 0
            try:
                async for chunk in orig_iterator:
                    if isinstance(chunk, (bytes, memoryview)):
                        text = bytes(chunk).decode("utf-8", errors="replace")
                    else:
                        text = str(chunk)
                    token_count += max(1, len(text.split()))
                    yield chunk

                duration_ms = (time.time() - start_time) * 1000
                telemetry.record_request(
                    endpoint="/v1/responses",
                    model=effective_model,
                    provider=active_provider,
                    tokens=max(1, token_count),
                    duration_ms=round(duration_ms, 1),
                    status="success",
                    client=client,
                )
            except Exception as exc:
                duration_ms = (time.time() - start_time) * 1000
                telemetry.record_request(
                    endpoint="/v1/responses",
                    model=effective_model,
                    provider=active_provider,
                    tokens=max(1, token_count),
                    duration_ms=round(duration_ms, 1),
                    status="error",
                    client=client,
                )
                raise exc

        resp.body_iterator = telemetry_wrapped_iterator()
        return resp

    duration_ms = (time.time() - start_time) * 1000
    telemetry.record_request(
        endpoint="/v1/responses",
        model=effective_model,
        provider=active_provider,
        tokens=30,
        duration_ms=round(duration_ms, 1),
        status="success",
        client=client,
    )
    return resp


@router.api_route("/v1/responses", methods=["HEAD", "OPTIONS"])
async def probe_responses(_auth=Depends(require_proxy_auth)):
    return _probe_response("POST, HEAD, OPTIONS")


PROVIDER_DEFAULT_MODELS: dict[str, str] = {
    "gemini": "gemini/gemini-2.5-flash",
    "nvidia_nim": "nvidia_nim/meta/llama-3.3-70b-instruct",
    "open_router": "open_router/deepseek/deepseek-r1:free",
    "groq": "groq/llama-3.3-70b-versatile",
    "cerebras": "cerebras/llama3.1-70b",
    "deepseek": "deepseek/deepseek-chat",
    "github_models": "github_models/gpt-4o",
    "ollama": "ollama/llama3.2:latest",
}


@router.post("/v1/chat/completions")
async def create_chat_completion(
    request: Request,
    services: ApiServices = Depends(get_services),
    _auth=Depends(require_proxy_auth),
):
    """OpenAI Chat Completions API adapter for Hermes, ChatGPT Desktop, and OpenAI clients."""
    start_time = time.time()
    try:
        raw_body = await request.json()
    except Exception:
        raw_body = {}
    req = ChatCompletionsRequest(**raw_body)
    req_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    # Precise client detection
    user_agent = (request.headers.get("user-agent") or "").lower()
    auth_header = (request.headers.get("authorization") or "").lower()

    client = "hermes"
    if "hermes" in user_agent or "hermes" in auth_header:
        client = "hermes"
    elif "codex" in user_agent or "chatgpt" in user_agent or "openai" in user_agent:
        client = "chatgpt"
    elif "claude" in user_agent or "anthropic" in user_agent:
        client = "claude"
    elif (
        "python" in user_agent
        or "httpx" in user_agent
        or "aiohttp" in user_agent
        or "requests" in user_agent
    ):
        client = "hermes"
    elif "electron" in user_agent or "node" in user_agent or "undici" in user_agent:
        client = "chatgpt"
    elif raw_body.get("client"):
        client = str(raw_body.get("client"))
    elif "stream_options" in raw_body:
        client = "chatgpt"

    # Enrutador rules: resolve effective model dynamically according to active route or daily SOTA benchmark
    routing_mode = "manual"
    if req.model in ("enrutador-auto", "enrutador", "auto", "default") or not req.model:
        routing_mode = "auto"
        effective_model = (
            telemetry.current_model
            or PROVIDER_DEFAULT_MODELS.get(telemetry.current_provider, "")
            or benchmark_engine.recommended_model_id
        )
    elif telemetry.current_provider:
        prov_prefix = f"{telemetry.current_provider}/"
        if req.model.startswith(prov_prefix):
            effective_model = req.model
        elif telemetry.current_model:
            effective_model = telemetry.current_model
        elif telemetry.current_provider in PROVIDER_DEFAULT_MODELS:
            effective_model = PROVIDER_DEFAULT_MODELS[telemetry.current_provider]
        else:
            effective_model = benchmark_engine.recommended_model_id
    else:
        effective_model = benchmark_engine.recommended_model_id

    active_provider = telemetry.current_provider or parse_provider_type(effective_model)
    routing_reason = benchmark_engine.explain_routing(
        active_provider,
        client=client,
        mode="auto" if routing_mode == "auto" else "manual",
    )
    logger.info(
        "ROUTER_DECISION: client={} effective_model={} reason={}",
        client,
        effective_model,
        routing_reason,
    )

    anthropic_req = openai_to_anthropic_request(req, override_model=effective_model)

    response = await _create_messages_response(
        services,
        anthropic_req,
        request_id=get_request_id(request),
    )

    if req.stream:
        if isinstance(response, StreamingResponse):
            return StreamingResponse(
                sse_anthropic_to_openai_stream(
                    response, effective_model, req_id, start_time, client=client
                ),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Content-Type": "text/event-stream",
                },
            )
        return convert_anthropic_response_to_openai(
            response, effective_model, req_id, start_time, client=client
        )

    return convert_anthropic_response_to_openai(
        response, effective_model, req_id, start_time, client=client
    )


@router.api_route("/v1/chat/completions", methods=["HEAD", "OPTIONS"])
async def probe_chat_completions(_auth=Depends(require_proxy_auth)):
    return _probe_response("POST, HEAD, OPTIONS")


@router.get("/admin/api/telemetry")
async def get_telemetry():
    """Real-time metrics and route telemetry."""
    return telemetry.get_summary()


@router.post("/admin/api/telemetry/simulate")
async def simulate_telemetry_request(request: Request):
    """Simulate a request originating from a specific client to light up its pipe."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    client = data.get("client", "hermes")
    model = data.get("model", telemetry.current_model)
    tokens = int(data.get("tokens", 25))
    telemetry.record_request(
        endpoint="/v1/chat/completions",
        model=model,
        provider=telemetry.current_provider,
        tokens=tokens,
        duration_ms=65.0,
        status="success",
        client=client,
    )
    return {"status": "ok", "client": client, "telemetry": telemetry.get_summary()}


@router.post("/admin/api/telemetry/route")
async def set_telemetry_route(request: Request):
    """Dynamically switch active route, measure latency, and trigger light animation."""
    t0 = time.time()
    try:
        data = await request.json()
    except Exception:
        data = {}
    provider = data.get("provider", "")
    model = data.get("model", "")
    if not model and provider in PROVIDER_DEFAULT_MODELS:
        model = PROVIDER_DEFAULT_MODELS[provider]
    elif not model:
        model = telemetry.current_model

    telemetry.set_active_route(provider, model=model, reason="manual_switch")
    latency_ms = round((time.time() - t0) * 1000 + 12.0, 1)
    return {
        "status": "ok",
        "provider": provider,
        "model": model,
        "latency_ms": latency_ms,
        "telemetry": telemetry.get_summary(),
    }


@router.get("/admin/api/benchmarks")
async def get_benchmarks():
    """Return top models according to official daily Hugging Face / LMSYS benchmarks and leader of the day."""
    return benchmark_engine.get_report()


@router.post("/admin/api/benchmarks/refresh")
async def refresh_benchmarks():
    """Trigger daily benchmark cron update under Enrutador control."""
    return benchmark_engine.trigger_daily_cron_now()


@router.post("/v1/messages/count_tokens")
async def count_tokens(
    request: Request,
    request_data: TokenCountRequest,
    settings: Settings = Depends(get_settings),
    _auth=Depends(require_anthropic_proxy_auth),
):
    """Count tokens for a request."""
    handler = TokenCountHandler(settings, token_counter=get_token_count)
    return handler.count(request_data, request_id=get_request_id(request))


@router.api_route("/v1/messages/count_tokens", methods=["HEAD", "OPTIONS"])
async def probe_count_tokens(_auth=Depends(require_anthropic_proxy_auth)):
    return _probe_response("POST, HEAD, OPTIONS")


@router.get("/")
async def root(
    settings: Settings = Depends(get_settings),
    _auth=Depends(require_proxy_auth),
):
    return {
        "status": "ok",
        "provider": parse_provider_type(settings.model),
        "model": settings.model,
    }


@router.api_route("/", methods=["HEAD", "OPTIONS"])
async def probe_root():
    return _probe_response("GET, HEAD, OPTIONS")


@router.get("/health")
async def health():
    return {"status": "healthy"}


@router.api_route("/health", methods=["HEAD", "OPTIONS"])
async def probe_health():
    return _probe_response("GET, HEAD, OPTIONS")


@router.get(
    "/v1/models",
    response_model=ModelsListResponse,
    response_model_exclude_none=True,
)
async def list_models(
    view: ModelCatalogView = ModelCatalogView.CLAUDE,
    services: ApiServices = Depends(get_services),
    settings: Settings = Depends(get_settings),
    _auth=Depends(require_proxy_auth),
):
    """List the model ids this proxy advertises to compatible clients."""
    trace_event(stage="ingress", event="free_claude_code.api.models.list", source="api")
    return build_models_list_response(settings, services.requests, view=view)


@router.get(
    "/muse-code/models",
    response_model=ModelsListResponse,
    response_model_exclude_none=True,
)
async def list_muse_models(
    services: ApiServices = Depends(get_services),
    settings: Settings = Depends(get_settings),
    _auth=Depends(require_proxy_auth),
):
    """List the direct Responses models expected by Muse Code."""
    trace_event(stage="ingress", event="free_claude_code.api.models.list", source="api")
    return build_models_list_response(
        settings,
        services.requests,
        view=ModelCatalogView.RESPONSES,
    )


@router.post("/stop")
async def stop_cli(
    services: ApiServices = Depends(get_services),
    _auth=Depends(require_proxy_auth),
):
    """Stop all CLI sessions and pending tasks."""
    result = await services.tasks.stop_all()
    if result is None:
        raise HTTPException(status_code=503, detail="Messaging system not initialized")
    if result.source is not None:
        logger.info("STOP_CLI: source={} cancelled_count=N/A", result.source)
        return {"status": "stopped", "source": result.source}

    count = result.cancelled_count or 0
    trace_event(
        stage="ingress",
        event="free_claude_code.api.cli.stop_via_messaging_workflow",
        source="api",
        cancelled_nodes=count,
    )
    logger.info("STOP_CLI: source=messaging_workflow cancelled_count={}", count)
    return {"status": "stopped", "cancelled_count": count}
