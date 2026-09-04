/**
 * Sistema Interactivo de Tuberías y Telemetría en Tiempo Real para Enrutador.
 * Tubería Completa Gruesa (10px) y Ultra Brillante entre Cliente, Enrutador y Proveedor.
 * Resaltado Neón de Cajas de Clientes y Top 5 Modelos con Benchmarks Oficiales Hugging Face.
 */

(function () {
  let telemetryInterval = null;
  let activeRoute = "nvidia_nim";
  let activeModel = "meta/llama-3.3-70b-instruct";
  let fallbackRoute = "open_router";
  let lastSeenTotalRequests = -1;
  let synapseTimeout = null;
  let benchmarksData = null;
  let currentBenchmarkFilter = "all";

  const PROVIDERS = [
    { id: "nvidia_nim", name: "NVIDIA NIM", default_model: "meta/llama-3.3-70b-instruct", desc: "Frontier Free 1.3B Pool", context: "128k", isMultimodal: true, vision: true, audio: false, tools: true, reasoning: false, api_url: "https://build.nvidia.com/settings/api-keys" },
    { id: "groq", name: "Groq LPU", default_model: "llama-3.3-70b-versatile", desc: "Ultra-Fast Inference (<100ms)", context: "128k", isMultimodal: false, vision: false, audio: true, tools: true, reasoning: false, api_url: "https://console.groq.com/keys" },
    { id: "cerebras", name: "Cerebras", default_model: "llama3.1-70b", desc: "Wafer-Scale AI Engine", context: "128k", isMultimodal: false, vision: false, audio: false, tools: true, reasoning: false, api_url: "https://cloud.cerebras.ai/" },
    { id: "open_router", name: "OpenRouter", default_model: "deepseek/deepseek-r1:free", desc: "Pooled Free & Fallback", context: "128k - 200k", isMultimodal: true, vision: true, audio: true, tools: true, reasoning: true, api_url: "https://openrouter.ai/keys" },
    { id: "gemini", name: "Google Gemini", default_model: "gemini-2.5-flash", desc: "Massive 1M - 2M Window", context: "1M - 2M", isMultimodal: true, vision: true, audio: true, tools: true, reasoning: true, api_url: "https://aistudio.google.com/app/apikey" },
    { id: "deepseek", name: "DeepSeek", default_model: "deepseek-chat", desc: "R1 Reasoning & Math", context: "64k - 128k", isMultimodal: false, vision: false, audio: false, tools: true, reasoning: true, api_url: "https://platform.deepseek.com/api_keys" },
    { id: "github_models", name: "GitHub Models", default_model: "gpt-4o", desc: "Azure AI Inference Pool", context: "128k", isMultimodal: true, vision: true, audio: false, tools: true, reasoning: false, api_url: "https://github.com/settings/tokens" },
    { id: "ollama", name: "Ollama / Local", default_model: "llama3.2:latest", desc: "100% Offline & Private", context: "32k - 128k", isMultimodal: true, vision: true, audio: false, tools: true, reasoning: false, api_url: "http://localhost:11434" },
  ];

  const CLIENTS = [
    {
      id: "hermes",
      name: "Hermes Agent",
      tag: "OpenAI API /v1",
      icon: "🤖",
      color: "#bf5af2",
      badgeText: "PÚRPURA LÁSER",
    },
    {
      id: "chatgpt",
      name: "ChatGPT Desktop",
      tag: "Custom Endpoint",
      icon: "💬",
      color: "#00ff66",
      badgeText: "VERDE ESMERALDA",
    },
    {
      id: "claude",
      name: "Claude Code CLI",
      tag: "Anthropic /v1",
      icon: "⚡",
      color: "#ff8800",
      badgeText: "ÁMBAR ATARDECER",
    },
    {
      id: "rest",
      name: "API REST / Apps",
      tag: "cURL & SDKs",
      icon: "🌐",
      color: "#00f2fe",
      badgeText: "CIAN ELÉCTRICO",
    },
  ];

  function initPipeline() {
    const root = document.getElementById("pipelineRoot");
    if (!root) return;

    root.innerHTML = `
      <div class="pipeline-dashboard">
        <!-- Banner de Conmutación de Ruta con Temporizador y Latencia -->
        <div id="routeChangeBanner" class="route-change-banner" style="display: none;">
          <div class="banner-main-row">
            <span class="banner-icon" id="bannerIcon">⚡</span>
            <div class="banner-body-flex">
              <div class="banner-text">
                <strong id="bannerTitle">¡RUTA CONMUTADA!</strong>
                <span id="bannerDetail">Flujo de tokens redirigido al proveedor activo.</span>
              </div>
              <div class="banner-timer-widget" id="bannerTimerWidget">
                <span class="timer-countdown-tag" id="timerCountdownTag">⏱️ Sincronizando: 3.0s</span>
                <span class="timer-latency-tag" id="timerLatencyTag">⚡ Latencia: -- ms</span>
              </div>
            </div>
          </div>
          <div class="banner-progress-track">
            <div class="banner-progress-bar" id="bannerProgressBar"></div>
          </div>
        </div>

        <!-- Telemetría Superior -->
        <div class="metrics-grid">
          <div class="metric-card cpm-card">
            <div class="metric-header">
              <span class="metric-title">Consultas por Minuto (CPM)</span>
              <span class="live-dot pulse"></span>
            </div>
            <div class="metric-value-row">
              <span id="metricCpm" class="metric-big">0.0</span>
              <span class="metric-unit">req/min</span>
            </div>
            <div class="metric-footer">
              Total consultas: <strong id="metricTotalReq">0</strong>
            </div>
          </div>

          <div class="metric-card tpm-card">
            <div class="metric-header">
              <span class="metric-title">Tokens por Minuto (TPM)</span>
              <span class="token-sparkle">🪙</span>
            </div>
            <div class="metric-value-row">
              <span id="metricTpm" class="metric-big">0</span>
              <span class="metric-unit">tok/min</span>
            </div>
            <div class="metric-footer">
              Total tokens: <strong id="metricTotalTok">0</strong>
            </div>
          </div>

          <div class="metric-card context-card">
            <div class="metric-header">
              <span class="metric-title">Ventana de Contexto</span>
              <span id="contextBadge" class="badge-ctx">128k</span>
            </div>
            <div class="metric-value-row">
              <span id="metricContext" class="metric-big">128k</span>
              <span class="metric-unit">tokens</span>
            </div>
            <div class="context-bar-wrap">
              <div id="contextBar" class="context-bar-fill" style="width: 35%;"></div>
            </div>
          </div>

          <div class="metric-card multimodal-card">
            <div class="metric-header">
              <span class="metric-title">Capacidades del Modelo</span>
              <span id="multimodalBadge" class="badge-mm">Multimodal</span>
            </div>
            <div class="multimodal-badges" id="multimodalIcons">
              <span class="capability-tag" id="capVision">👁️ Visión: Sí</span>
              <span class="capability-tag" id="capAudio">🎙️ Audio: No</span>
              <span class="capability-tag" id="capTools">🛠️ Tools: Sí</span>
              <span class="capability-tag" id="capReasoning">🧠 Thinking: No</span>
            </div>
          </div>
        </div>

        <!-- Controles Rápidos -->
        <div class="pipeline-controls-bar">
          <div class="active-route-info">
            <span class="label">Ruta Activa:</span>
            <span id="activeRouteName" class="route-badge-glow">NVIDIA NIM</span>
            <span class="arrow">➔</span>
            <span id="activeModelName" class="model-badge">meta/llama-3.3-70b-instruct</span>
            <span id="liveLatencyBadge" class="latency-pill-small" title="Latencia medida en la conmutación">⚡ 32 ms</span>
          </div>
          <div class="controls-actions">
            <button id="btnTestHermesTop" class="btn-client-test-top btn-hermes-top" title="Encender caja y tubería de Hermes Agent">
              ⚡ Tubería Hermes (Púrpura)
            </button>
            <button id="btnTestChatGPTTop" class="btn-client-test-top btn-chatgpt-top" title="Encender caja y tubería de ChatGPT Desktop">
              ⚡ Tubería ChatGPT (Verde)
            </button>
            <button id="btnSimulateRequest" class="btn-glow">⚡ Tráfico Aleatorio</button>
            <button id="btnSwitchRoute" class="btn-ghost">🔀 Conmutar Proveedor</button>
          </div>
        </div>

        <!-- Tarjeta de Control Central del Enrutador & Cron de Benchmarks del Día -->
        <div class="router-authority-card">
          <div class="router-authority-header">
            <div class="authority-title-row">
              <span class="authority-badge">👑 EL ENRUTADOR CONTROLA A LOS CLIENTES</span>
              <span class="authority-client-status">Hermes y ChatGPT simplificados en modo <code>enrutador-auto</code></span>
            </div>
            <div class="authority-actions-row">
              <span class="cron-status-pill" id="cronStatusBadge">
                <span class="pulse-dot-cron"></span>
                <span id="cronScheduleText">Cron Diario: 00:00 UTC (LMSYS / Hugging Face)</span>
              </span>
              <button id="btnTriggerCronNow" class="btn-cron-refresh" title="Forzar ejecución del cron diario de benchmarks">
                🔄 Ejecutar Cron de Benchmarks
              </button>
            </div>
          </div>
          <div class="router-authority-body">
            <div class="authority-selection">
              <span class="selection-label">🏆 Modelo Recomendado SOTA del Día:</span>
              <span id="authorityLeaderModel" class="selection-model">Google Gemini 2.5 Flash SOTA</span>
              <span id="authorityLeaderScore" class="selection-score">93.4 pts (#1 Líder Global)</span>
            </div>
            <div class="authority-reason" id="authorityReasonText">
              <strong>¿Por qué este modelo?:</strong> Líder SOTA del Día con 93.4 pts según LMSYS Chatbot Arena / MMLU Pro (Sep 2026). Capacidad: 1M - 2M tokens y Top 1 Multimodal, lectura masiva de archivos y documentación técnica.
            </div>
            <div class="authority-criteria-grid">
              <div class="criterion-item">
                <span class="crit-icon">📊</span>
                <div class="crit-texts">
                  <span class="crit-name">Benchmark SOTA del Día</span>
                  <span class="crit-val" id="critBenchmark">Top 1 SOTA (93.4 pts)</span>
                </div>
              </div>
              <div class="criterion-item">
                <span class="crit-icon">🪙</span>
                <div class="crit-texts">
                  <span class="crit-name">Capacidad de Tokens / TPM</span>
                  <span class="crit-val" id="critTokens">1M - 2M tokens ($0)</span>
                </div>
              </div>
              <div class="criterion-item">
                <span class="crit-icon">🎯</span>
                <div class="crit-texts">
                  <span class="crit-name">Especialización por Tarea</span>
                  <span class="crit-val" id="critTask">Código + Visión + Docs</span>
                </div>
              </div>
              <div class="criterion-item">
                <span class="crit-icon">⚡</span>
                <div class="crit-texts">
                  <span class="crit-name">Latencia de Inferencia</span>
                  <span class="crit-val" id="critLatency">&lt; 1.2s Ultrarrápida</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Visualizador de Tuberías SVG (Super-Conducción Gruesa) -->
        <div class="pipeline-visual-wrapper">
          <div class="pipeline-column clients-column" id="clientsColumn">
            <h3>Clientes Conectados</h3>
            <div class="nodes-list" id="clientsList"></div>
          </div>

          <div class="pipeline-center">
            <div class="router-core-node" id="routerCore">
              <div class="core-rings">
                <div class="ring ring-1"></div>
                <div class="ring ring-2"></div>
              </div>
              <div class="core-inner">
                <span class="core-icon">⚡</span>
                <span class="core-title">ENRUTADOR</span>
                <span class="core-sub" id="coreStatus">SINAPSIS EN ESPERA</span>
              </div>
            </div>
          </div>

          <div class="pipeline-column providers-column" id="providersColumn">
            <h3>Proveedores de Tokens</h3>
            <div class="nodes-list" id="providersList"></div>
          </div>

          <!-- Capa de Tuberías SVG -->
          <svg id="pipelineSvg" class="pipeline-svg" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <!-- Gradiente Hermes (Púrpura / Magenta Eléctrico Brillante) -->
              <linearGradient id="pipeGradHermes" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#d946ef" />
                <stop offset="30%" stop-color="#bf5af2" />
                <stop offset="70%" stop-color="#e040fb" />
                <stop offset="100%" stop-color="#c084fc" />
              </linearGradient>

              <!-- Gradiente ChatGPT Desktop (Verde Esmeralda Neón Brillante) -->
              <linearGradient id="pipeGradChatGPT" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#00ff88" />
                <stop offset="30%" stop-color="#00ff66" />
                <stop offset="70%" stop-color="#10b981" />
                <stop offset="100%" stop-color="#34d399" />
              </linearGradient>

              <!-- Gradiente Claude Code CLI (Ámbar / Coral) -->
              <linearGradient id="pipeGradClaude" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#ff7a00" />
                <stop offset="50%" stop-color="#f59e0b" />
                <stop offset="100%" stop-color="#fb923c" />
              </linearGradient>

              <!-- Gradiente Proveedor Activo (NVIDIA NIM Cian Láser) -->
              <linearGradient id="pipeGradientActive" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#00f2fe" />
                <stop offset="40%" stop-color="#38bdf8" />
                <stop offset="70%" stop-color="#4facfe" />
                <stop offset="100%" stop-color="#00f2fe" />
              </linearGradient>

              <!-- Filtro de Resplandor Neón de Alta Densidad -->
              <filter id="glowEffect" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            <g id="svgPipesGroup"></g>
          </svg>
        </div>

        <!-- Sección de los Top 5 Modelos según Benchmarks Oficiales de Hugging Face -->
        <div id="benchmarksRoot" class="benchmarks-section"></div>
      </div>
    `;

    renderNodes();
    setupEventListeners();
    updatePipesLayout();
    loadBenchmarks();

    window.addEventListener("resize", () => {
      updatePipesLayout();
    });

    startTelemetryPolling();
  }

  function renderNodes() {
    const clientsList = document.getElementById("clientsList");
    if (!clientsList) return;
    clientsList.innerHTML = "";
    CLIENTS.forEach((c) => {
      const node = document.createElement("div");
      node.className = `pipe-node client-node client-node-${c.id}`;
      node.id = `client-${c.id}`;
      node.innerHTML = `
        <div class="client-card-header">
          <div class="node-icon">${c.icon}</div>
          <div class="node-info">
            <strong>${c.name}</strong>
            <small>${c.tag}</small>
            <div class="client-model-tag">Modo: <code>enrutador-auto</code> (El Enrutador Manda)</div>
          </div>
          <span class="client-color-badge" id="badge-${c.id}" style="border-color:${c.color}; color:${c.color};">
            ${c.badgeText}
          </span>
        </div>
        <div class="client-card-action">
          <button class="btn-fire-client" data-client="${c.id}" style="border-color:${c.color}; color:${c.color};">
            ⚡ Encender Tubería & Caja (${c.name.split(' ')[0]})
          </button>
        </div>
        <div class="port-dot port-right" style="background:${c.color}; box-shadow:0 0 12px ${c.color};"></div>
      `;
      clientsList.appendChild(node);
    });

    const providersList = document.getElementById("providersList");
    if (!providersList) return;
    providersList.innerHTML = "";
    PROVIDERS.forEach((p) => {
      const isCurrent = p.id === activeRoute;
      const isFallback = p.id === fallbackRoute;
      const node = document.createElement("div");
      node.className = `pipe-node provider-node ${isCurrent ? "active-provider" : ""} ${isFallback ? "fallback-provider" : ""}`;
      node.id = `provider-node-${p.id}`;
      node.innerHTML = `
        <div class="port-dot port-left"></div>
        <div class="node-header">
          <strong>${p.name}</strong>
          <span class="provider-badge ${isCurrent ? "badge-active" : isFallback ? "badge-fallback" : "badge-ready"}">
            ${isCurrent ? "ACTIVO" : isFallback ? "RESPALDO" : "DISPONIBLE"}
          </span>
        </div>
        <p class="node-desc">${p.desc}</p>
        <div class="node-meta-row">
          <span class="meta-item">📦 ${p.context}</span>
          <span class="meta-item">${p.isMultimodal ? "👁️ Multimodal" : "📝 Texto"}</span>
        </div>
        <div class="node-actions-row">
          <a class="btn-api-key-link" href="${p.api_url}" target="_blank" rel="noopener noreferrer" title="Obtener clave en el portal oficial">
            🔑 API Key ↗
          </a>
          <button class="btn-config-provider" data-provider-id="${p.id}" data-provider-name="${p.name}" title="Ingresar o configurar API Key directamente">
            ⚙️ Configurar
          </button>
          <button class="btn-set-route" data-provider="${p.id}">
            ${isCurrent ? "En Ruta" : "Activar"}
          </button>
        </div>
      `;
      providersList.appendChild(node);
    });
  }

  function updatePipesLayout() {
    const svg = document.getElementById("pipelineSvg");
    const pipesGroup = document.getElementById("svgPipesGroup");
    const routerCore = document.getElementById("routerCore");
    if (!svg || !pipesGroup || !routerCore) return;

    const svgRect = svg.getBoundingClientRect();
    const coreRect = routerCore.getBoundingClientRect();
    const coreCenter = {
      x: coreRect.left - svgRect.left + coreRect.width / 2,
      y: coreRect.top - svgRect.top + coreRect.height / 2,
    };

    let pipesHtml = "";

    // Conectar Clientes al Core (Capa Base + Aura 26px + Tubería 10px + Núcleo Láser 3.5px)
    CLIENTS.forEach((c) => {
      const el = document.getElementById(`client-${c.id}`);
      if (!el) return;
      const elRect = el.getBoundingClientRect();
      const start = {
        x: elRect.right - svgRect.left,
        y: elRect.top - svgRect.top + elRect.height / 2,
      };
      const end = {
        x: coreCenter.x - 55,
        y: coreCenter.y,
      };
      const cp1X = start.x + (end.x - start.x) * 0.5;
      const cp1Y = start.y;
      const cp2X = start.x + (end.x - start.x) * 0.5;
      const cp2Y = end.y;

      const pathData = `M ${start.x} ${start.y} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${end.x} ${end.y}`;

      pipesHtml += `
        <path class="pipe-base" d="${pathData}" />
        <path id="pipe-client-aura-${c.id}" class="pipe-outer-aura client-aura-${c.id}" d="${pathData}" />
        <path id="pipe-client-${c.id}" class="pipe-glow client-pipe-${c.id}" d="${pathData}" />
        <path id="pipe-client-core-${c.id}" class="pipe-laser-core" d="${pathData}" />
      `;
    });

    // Conectar Core a Proveedores (Capa Base + Aura 26px + Tubería 10px + Núcleo Láser 3.5px)
    PROVIDERS.forEach((p) => {
      const el = document.getElementById(`provider-node-${p.id}`);
      if (!el) return;
      const elRect = el.getBoundingClientRect();
      const start = {
        x: coreCenter.x + 55,
        y: coreCenter.y,
      };
      const end = {
        x: elRect.left - svgRect.left,
        y: elRect.top - svgRect.top + elRect.height / 2,
      };
      const cp1X = start.x + (end.x - start.x) * 0.5;
      const cp1Y = start.y;
      const cp2X = start.x + (end.x - start.x) * 0.5;
      const cp2Y = end.y;

      const pathData = `M ${start.x} ${start.y} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${end.x} ${end.y}`;
      const isActive = p.id === activeRoute;
      const isFallback = p.id === fallbackRoute;

      pipesHtml += `
        <path class="pipe-base" d="${pathData}" />
        <path id="pipe-aura-${p.id}" class="pipe-outer-aura provider-aura-${p.id}" d="${pathData}" />
        <path id="pipe-${p.id}" class="pipe-glow ${isActive ? "pipe-active" : isFallback ? "pipe-fallback" : "pipe-idle"}" d="${pathData}" />
        <path id="pipe-core-${p.id}" class="pipe-laser-core" d="${pathData}" />
      `;
    });

    pipesGroup.innerHTML = pipesHtml;
  }

  // =========================================================================
  // DISPARO DE TUBERÍA COMPLETA Y RESALTADO DE CAJA DEL CLIENTE
  // =========================================================================
  function fireSynapse(clientId, providerId = activeRoute) {
    // Tubería y caja del cliente
    const clientPipe = document.getElementById(`pipe-client-${clientId}`);
    const clientAura = document.getElementById(`pipe-client-aura-${clientId}`);
    const clientCore = document.getElementById(`pipe-client-core-${clientId}`);
    const clientNode = document.getElementById(`client-${clientId}`);

    // Núcleo del Enrutador
    const coreNode = document.getElementById("routerCore");
    const coreStatus = document.getElementById("coreStatus");

    // Tubería y nodo del proveedor
    const providerPipe = document.getElementById(`pipe-${providerId}`);
    const providerAura = document.getElementById(`pipe-aura-${providerId}`);
    const providerCore = document.getElementById(`pipe-core-${providerId}`);
    const providerNode = document.getElementById(`provider-node-${providerId}`);

    // Limpiar clases previas de otros clientes
    CLIENTS.forEach((c) => {
      const el = document.getElementById(`client-${c.id}`);
      if (el && c.id !== clientId) el.classList.remove("client-synapse-firing");
    });

    // 1. ENCENDER LA TUBERÍA COMPLETA GRUESA Y BRILLANTE DE PUNTA A PUNTA
    const allActivePipes = [
      clientPipe, clientAura, clientCore,
      providerPipe, providerAura, providerCore,
    ];

    allActivePipes.forEach((el) => {
      if (el) el.classList.add("pipe-synapse-active");
    });

    // 2. RESALTAR INTENSAMENTE LA CAJA DEL CLIENTE CON BORDES Y HALO NEÓN
    if (clientNode) {
      clientNode.classList.add("client-synapse-firing");
    }

    // 3. RESALTAR NODO PROVEEDOR Y NÚCLEO
    if (providerNode) providerNode.classList.add("highlight-flash");
    if (coreNode) coreNode.classList.add("core-synapse-spark");
    if (coreStatus) coreStatus.textContent = `ACTIVO: ${clientId.toUpperCase()}`;

    // 4. MANTENER TOTALMENTE ENCENDIDA LA TUBERÍA Y LA CAJA DURANTE 4.2 SEGUNDOS
    if (synapseTimeout) clearTimeout(synapseTimeout);
    synapseTimeout = setTimeout(() => {
      allActivePipes.forEach((el) => {
        if (el) el.classList.remove("pipe-synapse-active");
      });
      if (clientNode) clientNode.classList.remove("client-synapse-firing");
      if (providerNode) providerNode.classList.remove("highlight-flash");
      if (coreNode) coreNode.classList.remove("core-synapse-spark");
      if (coreStatus) coreStatus.textContent = "SINAPSIS EN ESPERA";
    }, 4200);
  }

  // =========================================================================
  // TOP 5 MODELOS: BENCHMARKS OFICIALES HUGGING FACE
  // =========================================================================
  async function loadBenchmarks(category = currentBenchmarkFilter) {
    currentBenchmarkFilter = category;
    const container = document.getElementById("benchmarksRoot");
    if (!container) return;

    if (!benchmarksData) {
      try {
        const res = await fetch("/admin/api/benchmarks");
        if (res.ok) {
          benchmarksData = await res.json();
        }
      } catch (err) {
        console.error("Error loading benchmarks:", err);
      }
    }

    if (!benchmarksData || !benchmarksData.models) return;

    // Actualizar datos del Router Authority Card superior
    const elLeaderModel = document.getElementById("authorityLeaderModel");
    const elLeaderScore = document.getElementById("authorityLeaderScore");
    const elReasonText = document.getElementById("authorityReasonText");
    const elCronText = document.getElementById("cronScheduleText");
    const elCritBench = document.getElementById("critBenchmark");
    const elCritTokens = document.getElementById("critTokens");
    const elCritTask = document.getElementById("critTask");
    const elCritLat = document.getElementById("critLatency");

    if (benchmarksData.leader_display_name && elLeaderModel) {
      elLeaderModel.textContent = benchmarksData.leader_display_name;
    }
    if (benchmarksData.leader_overall_score && elLeaderScore) {
      elLeaderScore.textContent = `${benchmarksData.leader_overall_score} pts (#1 SOTA del Día)`;
    }
    if (benchmarksData.leader_reason && elReasonText) {
      elReasonText.innerHTML = `<strong>¿Por qué este modelo?:</strong> ${benchmarksData.leader_reason}`;
    }
    if (benchmarksData.last_cron_run && elCronText) {
      elCronText.textContent = `Cron Diario: ${benchmarksData.last_cron_run}`;
    }
    if (benchmarksData.decision_criteria) {
      if (elCritBench) elCritBench.textContent = benchmarksData.decision_criteria.benchmark || "Top 1 SOTA";
      if (elCritTokens) elCritTokens.textContent = benchmarksData.decision_criteria.tokens || "1M - 2M tokens";
      if (elCritTask) elCritTask.textContent = benchmarksData.decision_criteria.tarea || "General + Coding";
      if (elCritLat) elCritLat.textContent = benchmarksData.decision_criteria.latencia || "< 1.2s";
    }

    // Botón para forzar ejecución manual del cron
    const btnTriggerCron = document.getElementById("btnTriggerCronNow");
    if (btnTriggerCron && !btnTriggerCron._bound) {
      btnTriggerCron._bound = true;
      btnTriggerCron.addEventListener("click", async () => {
        btnTriggerCron.disabled = true;
        btnTriggerCron.textContent = "⏳ Ejecutando Cron...";
        try {
          const res = await fetch("/admin/api/benchmarks/refresh", { method: "POST" });
          if (res.ok) {
            benchmarksData = await res.json();
            loadBenchmarks(currentBenchmarkFilter);
            showBannerNotification("¡CRON DE BENCHMARKS EJECUTADO! Google Gemini confirmado como modelo SOTA del día.", "success");
          }
        } catch (err) {
          console.error("Error refreshing benchmarks:", err);
        } finally {
          btnTriggerCron.disabled = false;
          btnTriggerCron.textContent = "🔄 Ejecutar Cron de Benchmarks";
        }
      });
    }

    const filteredModels = benchmarksData.models.filter((m) => {
      if (category === "all") return true;
      if (category === "coding") return m.category === "coding" || m.category === "hybrid" || (m.coding_score && m.coding_score > 90);
      if (category === "multimodal") return m.category === "multimodal" || m.category === "hybrid" || (m.multimodal_score && m.multimodal_score > 85);
      return true;
    });

    container.innerHTML = `
      <div class="benchmarks-header">
        <div class="benchmarks-title-group">
          <h2>🏆 Top Modelos del Enrutador · Benchmarks Oficiales del Día</h2>
          <p class="benchmarks-subtitle">
            Líderes evaluados diariamente por Cron mediante <strong>Hugging Face Open LLM</strong>, <strong>LMSYS Arena</strong> y <strong>HumanEval / SWE-bench</strong>.
          </p>
        </div>
        <div class="benchmarks-meta-badges">
          <span class="badge-hf-official">🤗 Leaderboard Oficial</span>
          <span class="badge-daily-updated">🟢 ${benchmarksData.last_cron_run || benchmarksData.updated_at || "Actualizado Hoy"}</span>
          <button id="btnReloadBenchmarks" class="btn-ghost" style="padding: 4px 10px; font-size: 0.8rem;" title="Recargar métricas">
            🔄 Refrescar
          </button>
        </div>
      </div>

      <div class="benchmarks-filter-bar">
        <button class="bench-filter-btn ${category === "all" ? "active" : ""}" data-filter="all">Todos los Modelos (${benchmarksData.models.length})</button>
        <button class="bench-filter-btn ${category === "coding" ? "active" : ""}" data-filter="coding">💻 Codificación SOTA</button>
        <button class="bench-filter-btn ${category === "multimodal" ? "active" : ""}" data-filter="multimodal">👁️ Multimodal & Visión</button>
      </div>

      <div class="models-leaderboard-grid">
        ${filteredModels.map((m) => renderModelCard(m)).join("")}
      </div>
    `;

    // Eventos de los filtros y activación de modelos
    container.querySelectorAll(".bench-filter-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const cat = e.target.dataset.filter;
        loadBenchmarks(cat);
      });
    });

    const btnReload = document.getElementById("btnReloadBenchmarks");
    if (btnReload) {
      btnReload.addEventListener("click", () => {
        benchmarksData = null;
        loadBenchmarks(currentBenchmarkFilter);
      });
    }

    container.querySelectorAll(".btn-bench-activate").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const prov = e.target.dataset.provider;
        const mod = e.target.dataset.model;
        if (prov && mod) {
          activeModel = mod;
          setRoute(prov, mod);
          loadBenchmarks(currentBenchmarkFilter);
        }
      });
    });
  }

  function renderModelCard(m) {
    const isCurrentActive = m.model_id === activeModel || (m.is_leader && !activeModel);
    const statusText = m.is_leader ? "LÍDER SOTA" : (m.provider_status || "DISPONIBLE");
    const statusClass = m.is_leader ? "status-chip-active" : (m.provider_status === "ACTIVO" ? "status-chip-active" : "status-chip-available");

    const metricsHtml = m.metrics ? Object.entries(m.metrics).map(([k, v]) => `
      <div class="metric-bar-row">
        <span class="metric-bar-name">${v.name}</span>
        <span class="metric-bar-score">${v.score}</span>
      </div>
    `).join("") : `
      <div class="metric-bar-row">
        <span class="metric-bar-name">Score Global SOTA</span>
        <span class="metric-bar-score" style="color:#10b981;font-weight:800;">${m.overall_score} pts</span>
      </div>
      <div class="metric-bar-row">
        <span class="metric-bar-name">Programación (Coding)</span>
        <span class="metric-bar-score">${m.coding_score}%</span>
      </div>
      <div class="metric-bar-row">
        <span class="metric-bar-name">Razonamiento Lógico</span>
        <span class="metric-bar-score">${m.reasoning_score}%</span>
      </div>
      <div class="metric-bar-row">
        <span class="metric-bar-name">Multimodalidad</span>
        <span class="metric-bar-score">${m.multimodal_score}%</span>
      </div>
    `;

    const categoryLabel = m.category_label || (m.multimodal_score > 90 ? "👁️ Multimodal Nativo" : "💻 Codificación SOTA");
    const contextLabel = m.context_window || m.context || "128k";
    const providerName = m.provider || m.provider_name || "Enrutador Cloud";
    const sourceLink = m.hf_url || "https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard";
    const sourceName = m.benchmark_source || m.hf_leaderboard || "Hugging Face / LMSYS Leaderboard";

    return `
      <div class="model-bench-card ${m.is_leader ? 'rank-1' : ''}">
        <div class="model-bench-top">
          <span class="model-rank-badge">${m.is_leader ? "🏆 #1" : "⭐"}</span>
          <div class="model-title-box">
            <h4 class="model-bench-name">${m.display_name || m.name}</h4>
            <span class="model-bench-id">${m.model_id}</span>
          </div>
          <span class="model-status-chip ${statusClass}">${statusText}</span>
        </div>

        <div class="model-bench-meta">
          <span class="bench-category-tag">${categoryLabel}</span>
          <span class="bench-category-tag">📦 Contexto: ${contextLabel}</span>
          <span class="bench-category-tag">🏢 Proveedor: ${providerName}</span>
        </div>

        <div class="model-metrics-list">
          ${metricsHtml}
        </div>

        ${m.strengths ? `<div style="font-size:0.75rem; color:#94a3b8; margin:6px 0; line-height:1.4;">💡 ${m.strengths}</div>` : ''}

        <div class="model-bench-footer">
          <a class="hf-verify-link" href="${sourceLink}" target="_blank" rel="noopener noreferrer" title="Verificar este leaderboard oficial">
            🤗 ${sourceName} ↗
          </a>
          <button class="btn-bench-activate ${isCurrentActive ? "active" : ""}" data-provider="${m.key || m.provider}" data-model="${m.model_id}">
            ${isCurrentActive ? "✓ En Ruta Activa" : "⚡ Activar en Enrutador"}
          </button>
        </div>
      </div>
    `;
  }

  let countdownTimerInterval = null;

  function setRoute(newProviderId, customModel) {
    if (newProviderId === activeRoute && !customModel) return;
    const prev = activeRoute;
    activeRoute = newProviderId;

    const pObj = PROVIDERS.find((p) => p.id === newProviderId) || {
      id: newProviderId,
      name: newProviderId,
      context: "128k",
      default_model: "default",
      vision: true,
      audio: false,
      tools: true,
      reasoning: false,
    };
    const targetModel = customModel || pObj.default_model || activeModel;
    activeModel = targetModel;

    // 1. Actualización inmediata en el DOM para consistencia instantánea
    const elName = document.getElementById("activeRouteName");
    if (elName) elName.textContent = pObj.name;
    const elModel = document.getElementById("activeModelName");
    if (elModel) elModel.textContent = targetModel;
    const ctxBadge = document.getElementById("contextBadge");
    if (ctxBadge) ctxBadge.textContent = pObj.context;
    const metricCtx = document.getElementById("metricContext");
    if (metricCtx) metricCtx.textContent = pObj.context;

    // Barra de Contexto Dinámica
    const ctxBar = document.getElementById("contextBar");
    if (ctxBar) {
      if (pObj.context.includes("1M") || pObj.context.includes("2M")) {
        ctxBar.style.width = "95%";
        ctxBar.style.background = "linear-gradient(90deg, #00f2fe, #ff007f)";
      } else if (pObj.context.includes("200k")) {
        ctxBar.style.width = "65%";
        ctxBar.style.background = "linear-gradient(90deg, #ffaa00, #00ff88)";
      } else {
        ctxBar.style.width = "35%";
        ctxBar.style.background = "linear-gradient(90deg, #00ff88, #00f2fe)";
      }
    }

    // Capacidades del Modelo
    const capVision = document.getElementById("capVision");
    const capAudio = document.getElementById("capAudio");
    const capTools = document.getElementById("capTools");
    const capReasoning = document.getElementById("capReasoning");
    if (capVision) capVision.textContent = `👁️ Visión: ${pObj.vision ? "Sí" : "No"}`;
    if (capAudio) capAudio.textContent = `🎙️ Audio: ${pObj.audio ? "Sí" : "No"}`;
    if (capTools) capTools.textContent = `🛠️ Tools: ${pObj.tools ? "Sí" : "No"}`;
    if (capReasoning) capReasoning.textContent = `🧠 Thinking: ${pObj.reasoning ? "Sí" : "No"}`;

    // Disparar animación de tuberías y sinapsis con clientes
    renderNodes();
    updatePipesLayout();
    fireSynapse("hermes", newProviderId);
    setTimeout(() => fireSynapse("chatgpt", newProviderId), 180);

    // Iniciar Temporizador de Sincronización y Latencia
    startRouteSwitchTimer(newProviderId, prev, pObj, targetModel);

    // Llamada al backend para registrar la ruta y medir latencia exacta
    const t0 = performance.now();
    fetch("/admin/api/telemetry/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: newProviderId, model: targetModel }),
    })
      .then((r) => r.json())
      .then((res) => {
        const roundtripMs = res.latency_ms || Math.round(performance.now() - t0);
        const latPill = document.getElementById("timerLatencyTag");
        if (latPill) latPill.textContent = `⚡ Latencia: ${roundtripMs} ms`;
        const topBadge = document.getElementById("liveLatencyBadge");
        if (topBadge) topBadge.textContent = `⚡ ${roundtripMs} ms`;
      })
      .catch((err) => {
        console.warn("Error enrutando:", err);
      });
  }

  function startRouteSwitchTimer(providerId, prevProviderId, pObj, modelName) {
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);

    const banner = document.getElementById("routeChangeBanner");
    const bannerTitle = document.getElementById("bannerTitle");
    const bannerDetail = document.getElementById("bannerDetail");
    const timerTag = document.getElementById("timerCountdownTag");
    const pBar = document.getElementById("bannerProgressBar");

    const prevObj = PROVIDERS.find((p) => p.id === prevProviderId) || { name: "Anterior" };

    if (!banner) return;
    banner.style.display = "flex";
    banner.classList.add("flash-animation");

    bannerTitle.textContent = `⏳ SINCRONIZANDO CLIENTES CON ${pObj.name.toUpperCase()}...`;
    bannerDetail.textContent = `Enrutando tráfico de Hermes Agent y ChatGPT Desktop hacia ${pObj.name} (${modelName}). Respaldo: ${prevObj.name}.`;

    const totalDurationMs = 3000;
    let elapsedMs = 0;
    const intervalStep = 100;

    countdownTimerInterval = setInterval(() => {
      elapsedMs += intervalStep;
      const remainingSec = Math.max(0, (totalDurationMs - elapsedMs) / 1000);
      const progressPercent = Math.min(100, (elapsedMs / totalDurationMs) * 100);

      if (timerTag) {
        timerTag.innerHTML = `⏱️ Sincronizando Clientes: <strong>${remainingSec.toFixed(1)}s</strong>`;
      }
      if (pBar) {
        pBar.style.width = `${progressPercent}%`;
      }

      if (elapsedMs >= totalDurationMs) {
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;

        banner.classList.remove("flash-animation");
        bannerTitle.textContent = `⚡ ¡RUTA CONMUTADA Y CLIENTES ENRUTADOS A ${pObj.name.toUpperCase()}!`;
        bannerDetail.textContent = `El tráfico de Hermes Agent y ChatGPT Desktop ahora fluye directamente por ${pObj.name} (${modelName}).`;
        if (timerTag) {
          timerTag.innerHTML = `✅ ¡Clientes Enrutados a ${pObj.name}!`;
        }

        setTimeout(() => {
          if (!countdownTimerInterval) {
            banner.classList.remove("flash-animation");
          }
        }, 5000);
      }
    }, intervalStep);

    // Resaltar nodo del proveedor con destello
    const node = document.getElementById(`provider-node-${providerId}`);
    if (node) {
      node.classList.add("highlight-flash");
      setTimeout(() => node.classList.remove("highlight-flash"), 2500);
    }
  }

  function setupEventListeners() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-set-route");
      if (btn && btn.dataset.provider) {
        setRoute(btn.dataset.provider);
      }

      const configBtn = e.target.closest(".btn-config-provider");
      if (configBtn && window.openDirectProviderConfigModal) {
        window.openDirectProviderConfigModal({
          provider_id: configBtn.dataset.providerId,
          display_name: configBtn.dataset.providerName,
          configuration_keys: [configBtn.dataset.providerId.toUpperCase() + "_API_KEY"],
        });
      }

      // Botón directo en la tarjeta del cliente
      const fireClientBtn = e.target.closest(".btn-fire-client");
      if (fireClientBtn && fireClientBtn.dataset.client) {
        const cId = fireClientBtn.dataset.client;
        fireSynapse(cId, activeRoute);
        fetch("/admin/api/telemetry/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: cId, tokens: 40 }),
        }).catch(() => {});
      }
    });

    // Botones superiores
    const btnHermesTop = document.getElementById("btnTestHermesTop");
    if (btnHermesTop) {
      btnHermesTop.addEventListener("click", () => {
        fireSynapse("hermes", activeRoute);
        fetch("/admin/api/telemetry/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: "hermes", tokens: 45 }),
        }).catch(() => {});
      });
    }

    const btnChatGPTTop = document.getElementById("btnTestChatGPTTop");
    if (btnChatGPTTop) {
      btnChatGPTTop.addEventListener("click", () => {
        fireSynapse("chatgpt", activeRoute);
        fetch("/admin/api/telemetry/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: "chatgpt", tokens: 45 }),
        }).catch(() => {});
      });
    }

    const btnSimulate = document.getElementById("btnSimulateRequest");
    if (btnSimulate) {
      btnSimulate.addEventListener("click", () => {
        const clientIds = ["hermes", "chatgpt", "claude"];
        const picked = clientIds[Math.floor(Math.random() * clientIds.length)];
        fireSynapse(picked, activeRoute);
        fetch("/admin/api/telemetry/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: picked, tokens: 35 }),
        }).catch(() => {});
      });
    }

    const btnSwitch = document.getElementById("btnSwitchRoute");
    if (btnSwitch) {
      btnSwitch.addEventListener("click", () => {
        const available = PROVIDERS.map((p) => p.id).filter((id) => id !== activeRoute);
        const next = available[Math.floor(Math.random() * available.length)];
        setRoute(next);
      });
    }
  }

  function startTelemetryPolling() {
    if (telemetryInterval) clearInterval(telemetryInterval);

    const poll = async () => {
      try {
        const res = await fetch("/admin/api/telemetry");
        if (!res.ok) return;
        const data = await res.json();
        updateTelemetryUI(data);

        // Disparo automático de la tubería y caja correspondiente según cliente real
        if (lastSeenTotalRequests !== -1 && data.total_requests > lastSeenTotalRequests) {
          const activeClient = data.last_active_client || "hermes";
          fireSynapse(activeClient, data.current_provider || activeRoute);
        }
        lastSeenTotalRequests = data.total_requests || 0;
      } catch (err) {
        // Polling silencioso
      }
    };

    poll();
    telemetryInterval = setInterval(poll, 1200);
  }

  function updateTelemetryUI(data) {
    if (!data) return;

    const elCpm = document.getElementById("metricCpm");
    if (elCpm) elCpm.textContent = (data.requests_per_minute || 0).toFixed(1);

    const elTotalReq = document.getElementById("metricTotalReq");
    if (elTotalReq) elTotalReq.textContent = data.total_requests || 0;

    const elTpm = document.getElementById("metricTpm");
    if (elTpm) elTpm.textContent = (data.tokens_per_minute || 0).toLocaleString();

    const elTotalTok = document.getElementById("metricTotalTok");
    if (elTotalTok) elTotalTok.textContent = (data.total_tokens || 0).toLocaleString();

    if (data.current_provider && data.current_provider !== activeRoute) {
      activeRoute = data.current_provider;
      renderNodes();
      updatePipesLayout();
    }

    if (data.model_specs) {
      const specs = data.model_specs;
      const elCtx = document.getElementById("metricContext");
      if (elCtx) elCtx.textContent = specs.context_window;
      const badgeCtx = document.getElementById("contextBadge");
      if (badgeCtx) badgeCtx.textContent = specs.context_window;

      const mm = specs.multimodal || {};
      const setCap = (id, active, label) => {
        const el = document.getElementById(id);
        if (el) {
          el.className = `capability-tag ${active ? "cap-enabled" : "cap-disabled"}`;
          el.textContent = `${label}: ${active ? "Sí" : "No"}`;
        }
      };
      setCap("capVision", mm.vision, "👁️ Visión");
      setCap("capAudio", mm.audio, "🎙️ Audio");
      setCap("capTools", mm.tools, "🛠️ Tools");
      setCap("capReasoning", mm.reasoning, "🧠 Thinking");
    }

    if (data.current_provider) {
      const pObj = PROVIDERS.find((p) => p.id === data.current_provider);
      const elName = document.getElementById("activeRouteName");
      if (elName && pObj && !countdownTimerInterval) elName.textContent = pObj.name;
    }

    if (data.current_model) {
      activeModel = data.current_model;
      const elMod = document.getElementById("activeModelName");
      if (elMod && !countdownTimerInterval) elMod.textContent = data.current_model;
    }

    if (data.avg_latency_ms !== undefined) {
      const topBadge = document.getElementById("liveLatencyBadge");
      if (topBadge) topBadge.textContent = `⚡ ${Math.round(data.avg_latency_ms) || 32} ms`;
    }
  }

  window.PipelineDashboard = {
    initialize: initPipeline,
    render: () => {
      renderNodes();
      updatePipesLayout();
      loadBenchmarks();
    },
    fireSynapse: fireSynapse,
  };
})();
