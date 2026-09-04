const PROVIDER_API_PORTALS = {
  nvidia_nim: "https://build.nvidia.com/settings/api-keys",
  open_router: "https://openrouter.ai/keys",
  groq: "https://console.groq.com/keys",
  cerebras: "https://cloud.cerebras.ai/",
  gemini: "https://aistudio.google.com/app/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
  github_models: "https://github.com/settings/tokens",
  xai: "https://console.x.ai/team/default/api-keys",
  mistral: "https://console.mistral.ai/api-keys/",
  together: "https://api.together.ai/settings/api-keys",
  sambanova: "https://cloud.sambanova.ai/apis",
  fireworks: "https://fireworks.ai/api-keys",
  novita: "https://novita.ai/settings/key-management",
  cloudflare: "https://dash.cloudflare.com/",
  huggingface: "https://huggingface.co/settings/tokens",
  cohere: "https://dashboard.cohere.com/api-keys",
  minimax: "https://platform.minimax.io/user-center/basic-information/interface-key",
  kimi: "https://platform.moonshot.cn/console/api-keys",
  ollama: "https://ollama.com",
  lmstudio: "http://localhost:1234",
  llamacpp: "http://localhost:8080",
};

const state = {
  config: null,
  fields: new Map(),
  modelOptions: [],
  modelComboboxes: new Set(),
  authPollers: new Map(),
  activeView: window.location.pathname.startsWith("/admin/chat") ? "chat" : "pipeline",
};

const MASKED_SECRET = "********";
const NULL_VALUE = "__FCC_NULL__";
const VIEW_GROUPS = [
  {
    id: "pipeline",
    icon: "⚡",
    label: "Tuberías & Métricas",
    subtitle: "Telemetría y tráfico en vivo",
    title: "Sistema de Tuberías y Telemetría en Tiempo Real",
    sections: [],
    containerId: "pipelineRoot",
  },
  {
    id: "providers",
    icon: "🔑",
    label: "Proveedores",
    subtitle: "API Keys y Servidores Locales",
    title: "Gestión de Proveedores de Tokens",
    sections: ["providers", "runtime"],
    containerId: "providersSections",
  },
  {
    id: "model_config",
    icon: "🧠",
    label: "Modelos & Rutas",
    subtitle: "Asignación de IA por tarea",
    title: "Configuración de Modelos y Rutas de IA",
    sections: ["models", "reasoning", "web_tools"],
    containerId: "modelConfigSections",
  },
  {
    id: "integrations",
    icon: "🔌",
    label: "Hermes & ChatGPT",
    subtitle: "Conexión de apps al puerto :8082",
    title: "Guía de Conexión para Clientes y Agentes",
    sections: [],
    containerId: "integrationsRoot",
  },
  {
    id: "messaging",
    icon: "💬",
    label: "Mensajería",
    subtitle: "Bots Telegram, Discord y Voz",
    title: "Configuración de Bots y Mensajería",
    sections: ["messaging", "voice"],
    containerId: "messagingSections",
  },
  {
    id: "chat",
    icon: "🧪",
    label: "Chat de Prueba",
    subtitle: "Consola de prueba en vivo",
    title: "Consola Interactiva de Chat",
    sections: [],
    containerId: "chatRoot",
  },
];

const byId = (id) => document.getElementById(id);

function sourceLabel(source) {
  const labels = {
    default: "default",
    managed_env: "",
    process: "process env",
  };
  return Object.prototype.hasOwnProperty.call(labels, source) ? labels[source] : source;
}

function sourceText(field) {
  const parts = [];
  const label = sourceLabel(field.source);
  if (label) {
    parts.push(label);
  }
  if (field.locked) {
    parts.push("locked");
  }
  return parts.join(" ");
}

function statusClass(status) {
  if (["configured", "reachable", "running", "connected"].includes(status)) return "ok";
  if (["missing_key", "missing_config", "missing_url", "unknown", "connecting"].includes(status)) return "warn";
  if (["offline", "error"].includes(status)) return "error";
  return "neutral";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch {
      // The status remains useful when an upstream proxy returns a non-JSON page.
    }
    const error = new Error(detail || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function load() {
  showMessage("Loading admin config");
  const config = await api("/admin/api/config");
  state.config = config;
  state.fields = new Map(config.fields.map((field) => [field.key, field]));
  renderNav();
  renderProviders(config.provider_status);
  renderSections(config.sections, config.fields);
  byId("configPath").textContent = config.paths.managed;
  await Promise.all([
    refreshConnectedAccounts(),
    hydrateModelOptions(),
    refreshLocalStatus(),
    window.ChatSessions ? window.ChatSessions.initialize(api) : Promise.resolve(),
  ]);
  updateDirtyState();
  showMessage("");
  if (state.activeView === "pipeline" && window.PipelineDashboard) {
    window.PipelineDashboard.initialize();
  }
}

function renderNav() {
  const nav = byId("sectionNav");
  nav.innerHTML = "";
  VIEW_GROUPS.forEach((view, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-link${index === 0 ? " active" : ""}`;
    button.dataset.view = view.id;

    const iconSpan = document.createElement("span");
    iconSpan.className = "nav-icon";
    iconSpan.textContent = view.icon || "⚡";
    button.appendChild(iconSpan);

    const textWrap = document.createElement("div");
    textWrap.className = "nav-text-wrap";

    const labelSpan = document.createElement("span");
    labelSpan.className = "nav-label";
    labelSpan.textContent = view.label;
    textWrap.appendChild(labelSpan);

    if (view.subtitle) {
      const subSpan = document.createElement("span");
      subSpan.className = "nav-sublabel";
      subSpan.textContent = view.subtitle;
      textWrap.appendChild(subSpan);
    }

    button.appendChild(textWrap);

    if (index === 0) {
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => {
      navigateToView(view.id);
    });
    nav.appendChild(button);
  });
  setActiveView(state.activeView, { scroll: false });
}

function setActiveView(viewId, { scroll = false } = {}) {
  const activeView =
    VIEW_GROUPS.find((view) => view.id === viewId) || VIEW_GROUPS[0];
  state.activeView = activeView.id;
  byId("pageTitle").textContent = activeView.title;
  const chatActive = activeView.id === "chat";
  document.querySelector(".app-shell").classList.toggle("chat-active", chatActive);
  document.querySelector(".main").classList.toggle("chat-main", chatActive);
  document.querySelector(".topbar").hidden = chatActive;
  document.querySelector(".action-bar").hidden = chatActive;

  document.querySelectorAll(".nav-link").forEach((link) => {
    const selected = link.dataset.view === activeView.id;
    link.classList.toggle("active", selected);
    if (selected) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  document.querySelectorAll(".admin-view").forEach((view) => {
    const selected = view.dataset.view === activeView.id;
    view.classList.toggle("active", selected);
    view.hidden = !selected;
  });

  if (scroll) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (chatActive && window.ChatSessions) {
    window.ChatSessions.activate(window.location.pathname);
  }
  if (activeView.id === "pipeline" && window.PipelineDashboard) {
    window.PipelineDashboard.initialize();
  }
}

function navigateToView(viewId) {
  if (viewId === "chat") {
    if (window.location.pathname !== "/admin/chat") {
      window.history.pushState({}, "", "/admin/chat");
    }
  } else if (window.location.pathname.startsWith("/admin/chat")) {
    window.history.pushState({}, "", "/admin");
  }
  setActiveView(viewId, { scroll: true });
}

function sortProviders(providers) {
  return [...providers].sort((a, b) => {
    const aConf = ["configured", "reachable", "running", "connected"].includes(a.status);
    const bConf = ["configured", "reachable", "running", "connected"].includes(b.status);
    if (aConf && !bConf) return -1;
    if (!aConf && bConf) return 1;
    const aName = a.display_name || a.provider_id;
    const bName = b.display_name || b.provider_id;
    return aName.localeCompare(bName);
  });
}

function renderProviderCard(provider) {
  const isConfigured = ["configured", "reachable", "running", "connected"].includes(provider.status);
  const card = document.createElement("article");
  card.className = `provider-card${isConfigured ? " provider-card-active" : ""}`;
  card.dataset.provider = provider.provider_id;
  card.dataset.kind = provider.kind || "remote";
  card.dataset.configured = isConfigured ? "true" : "false";

  const title = document.createElement("div");
  title.className = "provider-title";
  const name = document.createElement("strong");
  name.textContent = provider.display_name || provider.provider_id;

  const pill = document.createElement("span");
  pill.className = `status-pill ${statusClass(provider.status)}`;
  pill.textContent = provider.label;
  title.append(name, pill);

  const meta = document.createElement("div");
  meta.className = "provider-meta";
  const configurationKeys = Array.isArray(provider.configuration_keys)
    ? provider.configuration_keys
    : [];
  const missingConfigurationKeys = Array.isArray(
    provider.missing_configuration_keys,
  )
    ? provider.missing_configuration_keys
    : [];
  meta.textContent = configurationKeys.join(" + ");

  const result = document.createElement("div");
  result.className = "provider-check-result";
  result.dataset.providerCheckResult = provider.provider_id;
  result.setAttribute("aria-live", "polite");
  result.hidden = true;

  const actions = document.createElement("div");
  actions.className = "provider-actions";

  const portalUrl = PROVIDER_API_PORTALS[provider.provider_id];
  if (portalUrl) {
    const apiLink = document.createElement("a");
    apiLink.className = "provider-api-shortcut";
    apiLink.href = portalUrl;
    apiLink.target = "_blank";
    apiLink.rel = "noopener noreferrer";
    apiLink.innerHTML = "🔑 Obtener API Key ↗";
    apiLink.title = `Abrir portal oficial para generar clave de ${provider.display_name || provider.provider_id}`;
    actions.appendChild(apiLink);
  }

  if (configurationKeys.length) {
    const configuring = missingConfigurationKeys.length > 0;
    actions.appendChild(
      providerActionButton(configuring ? "Configure" : "Edit", () =>
        navigateToProviderConfiguration(provider, configuring),
      ),
    );
  }

  if (missingConfigurationKeys.length === 0) {
    const button = providerActionButton(
      provider.kind === "local" ? "Test" : "Refresh models",
      () => testProvider(provider.provider_id, button),
      "secondary-button",
    );
    actions.appendChild(button);
  }

  card.append(title, meta, result, actions);
  return card;
}

let activeProviderFilter = "all";
let activeProviderSearch = "";

function applyProviderFilters() {
  const q = activeProviderSearch.trim().toLowerCase();
  const filter = activeProviderFilter;

  const activeSec = byId("activeProvidersSection");
  const cloudSec = byId("cloudProvidersSection");
  const localSec = byId("localProvidersSection");
  const connSec = byId("connectedAccountsSection");

  if (activeSec) activeSec.hidden = filter === "cloud" || filter === "local";
  if (cloudSec) cloudSec.hidden = filter === "active" || filter === "local";
  if (localSec) localSec.hidden = filter === "active" || filter === "cloud";
  if (connSec && connSec.dataset.empty !== "true") {
    connSec.hidden = filter === "active" || filter === "local";
  }

  document.querySelectorAll(".provider-grid .provider-card").forEach((card) => {
    if (!q) {
      card.style.display = "";
      return;
    }
    const text = (card.textContent || "").toLowerCase();
    const provId = (card.dataset.provider || "").toLowerCase();
    const match = text.includes(q) || provId.includes(q);
    card.style.display = match ? "" : "none";
  });
}

function renderProviders(providerStatus) {
  const activeGrid = byId("activeProviderGrid");
  const cloudGrid = byId("cloudProviderGrid");
  const localGrid = byId("localProviderGrid");
  const connectedGrid = byId("connectedAccountGrid");
  const fallbackGrid = byId("providerGrid");

  if (activeGrid) activeGrid.innerHTML = "";
  if (cloudGrid) cloudGrid.innerHTML = "";
  if (localGrid) localGrid.innerHTML = "";
  if (connectedGrid) connectedGrid.innerHTML = "";
  if (fallbackGrid) fallbackGrid.innerHTML = "";

  const connected = providerStatus.filter(
    (provider) => provider.kind === "connected_account",
  );
  const connSec = byId("connectedAccountsSection");
  if (connSec) {
    connSec.hidden = connected.length === 0;
    connSec.dataset.empty = connected.length === 0 ? "true" : "false";
  }
  connected.forEach((provider) => {
    if (connectedGrid) {
      connectedGrid.appendChild(renderConnectedAccountCard(provider));
    }
  });

  const nonConnected = providerStatus.filter(
    (provider) => provider.kind !== "connected_account",
  );

  const isConfigured = (p) =>
    ["configured", "reachable", "running", "connected"].includes(p.status);

  // Partition and sort providers
  const activeList = sortProviders(nonConnected.filter(isConfigured));
  const cloudList = sortProviders(nonConnected.filter((p) => p.kind === "remote"));
  const localList = sortProviders(nonConnected.filter((p) => p.kind === "local"));
  const allSorted = sortProviders(nonConnected);

  // Update Badges and Counts
  const totalCountEl = byId("totalProvidersCount");
  const activeCountEl = byId("activeFilterCount");
  const activeBadge = byId("activeCountBadge");
  const cloudBadge = byId("cloudCountBadge");
  const localBadge = byId("localCountBadge");

  if (totalCountEl) totalCountEl.textContent = nonConnected.length;
  if (activeCountEl) activeCountEl.textContent = activeList.length;
  if (activeBadge) {
    activeBadge.textContent = `${activeList.length} Activo${activeList.length === 1 ? "" : "s"}`;
  }
  if (cloudBadge) cloudBadge.textContent = `${cloudList.length} Proveedores`;
  if (localBadge) localBadge.textContent = `${localList.length} Motores`;

  // Render Active Rack
  if (activeGrid) {
    if (activeList.length === 0) {
      const emptyNote = document.createElement("div");
      emptyNote.className = "empty-rack-msg";
      emptyNote.textContent = "⚡ Aún no has configurado ningún proveedor. Elige uno de los proveedores Cloud o Locales a continuación para activarlo con tu API Key.";
      activeGrid.appendChild(emptyNote);
    } else {
      activeList.forEach((p) => activeGrid.appendChild(renderProviderCard(p)));
    }
  }

  // Render Cloud Grid
  if (cloudGrid) {
    cloudList.forEach((p) => cloudGrid.appendChild(renderProviderCard(p)));
  }

  // Render Local Grid
  if (localGrid) {
    localList.forEach((p) => localGrid.appendChild(renderProviderCard(p)));
  }

  // Render fallback grid for tests or query selectors
  if (fallbackGrid) {
    allSorted.forEach((p) => fallbackGrid.appendChild(renderProviderCard(p)));
  }

  // Bind filter pills & search box
  const searchInput = byId("providerSearchInput");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      activeProviderSearch = e.target.value;
      applyProviderFilters();
    });
  }

  const filterContainer = byId("providerFilterPills");
  if (filterContainer && !filterContainer.dataset.bound) {
    filterContainer.dataset.bound = "true";
    filterContainer.querySelectorAll(".filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        filterContainer.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeProviderFilter = btn.dataset.filter || "all";
        applyProviderFilters();
      });
    });
  }

  applyProviderFilters();
}

function providerActionButton(label, action, className = "test-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function openDirectProviderConfigModal(provider, configuring = true) {
  const modal = byId("apiKeyModal");
  if (!modal) {
    return;
  }

  const titleEl = byId("modalProviderTitle");
  const subtitleEl = byId("modalProviderSubtitle");
  const portalLinkEl = byId("modalPortalLink");
  const inputEl = byId("modalApiKeyInput");
  const hintEl = byId("modalFieldHint");
  const statusMsgEl = byId("modalStatusMsg");
  const saveBtn = byId("modalSaveBtn");
  const cancelBtn = byId("modalCancelBtn");
  const closeBtn = byId("modalCloseBtn");
  const toggleBtn = byId("modalToggleVisibilityBtn");

  const displayName = provider.display_name || provider.provider_id;
  titleEl.textContent = `Configurar ${displayName}`;
  subtitleEl.textContent = `Pega aquí directamente tu API Key oficial para ${displayName}.`;

  const portalUrl = PROVIDER_API_PORTALS[provider.provider_id] || "https://google.com";
  portalLinkEl.href = portalUrl;
  portalLinkEl.textContent = `🔑 Obtener API Key Oficial de ${displayName} ↗`;

  const keys = Array.isArray(provider.configuration_keys) && provider.configuration_keys.length > 0
    ? provider.configuration_keys
    : (Array.isArray(provider.missing_configuration_keys) ? provider.missing_configuration_keys : []);
  const fieldKey = keys.length > 0 ? keys[0] : `${provider.provider_id.toUpperCase()}_API_KEY`;

  hintEl.textContent = `Variable en .env: ${fieldKey}`;
  inputEl.value = "";
  inputEl.placeholder = `Pega aquí tu API key de ${displayName}...`;
  inputEl.type = "password";
  toggleBtn.textContent = "👁️";

  statusMsgEl.hidden = true;
  statusMsgEl.className = "modal-status-msg";
  statusMsgEl.textContent = "";
  saveBtn.disabled = false;
  saveBtn.textContent = "Guardar y Activar Clave";

  const closeModal = () => {
    modal.hidden = true;
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  toggleBtn.onclick = () => {
    if (inputEl.type === "password") {
      inputEl.type = "text";
      toggleBtn.textContent = "🔒";
    } else {
      inputEl.type = "password";
      toggleBtn.textContent = "👁️";
    }
  };

  saveBtn.onclick = async () => {
    const val = inputEl.value.trim();
    if (!val) {
      statusMsgEl.hidden = false;
      statusMsgEl.className = "modal-status-msg status-error";
      statusMsgEl.textContent = "⚠️ Por favor ingresa una API Key antes de guardar.";
      inputEl.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    statusMsgEl.hidden = false;
    statusMsgEl.className = "modal-status-msg status-loading";
    statusMsgEl.textContent = `Guardando ${fieldKey} y verificando conexión con ${displayName}...`;

    try {
      const applyPayload = { values: { [fieldKey]: val } };
      const applyRes = await api("/admin/api/config/apply", {
        method: "POST",
        body: JSON.stringify(applyPayload),
      });

      if (!applyRes.valid) {
        throw new Error(applyRes.errors?.join(", ") || "Error de validación");
      }

      // Test the provider
      const testRes = await api(`/admin/api/providers/${provider.provider_id}/test`, {
        method: "POST",
      });

      statusMsgEl.className = "modal-status-msg status-success";
      const modelCount = testRes.models ? testRes.models.length : 0;
      statusMsgEl.textContent = `✅ ¡API Key guardada en .env y activada con éxito! (${modelCount} modelos disponibles)`;

      saveBtn.textContent = "¡Guardado!";

      setTimeout(async () => {
        closeModal();
        await load();
        if (window.PipelineDashboard) {
          window.PipelineDashboard.render();
        }
      }, 1400);

    } catch (err) {
      statusMsgEl.className = "modal-status-msg status-error";
      statusMsgEl.textContent = `❌ Error al aplicar API key: ${err.message || err}`;
      saveBtn.disabled = false;
      saveBtn.textContent = "Reintentar Guardar";
    }
  };

  modal.hidden = false;
  setTimeout(() => inputEl.focus(), 60);
}

window.openDirectProviderConfigModal = openDirectProviderConfigModal;

function navigateToProviderConfiguration(provider, configuring) {
  openDirectProviderConfigModal(provider, configuring);
}

function renderConnectedAccountCard(provider, status = provider) {
  const card = document.createElement("article");
  card.className = "provider-card";
  card.dataset.provider = provider.provider_id;
  card.dataset.connectedAccount = "true";

  const title = document.createElement("div");
  title.className = "provider-title";
  const name = document.createElement("strong");
  name.textContent = provider.display_name || provider.provider_id;
  const pill = document.createElement("span");
  pill.className = `status-pill ${statusClass(status.state || status.status)}`;
  pill.textContent = connectedAccountLabel(status);
  title.append(name, pill);

  const meta = document.createElement("div");
  meta.className = "provider-meta";
  meta.textContent = connectedAccountMeta(status);

  const actions = document.createElement("div");
  actions.className = "provider-actions";
  populateConnectedAccountActions(provider, status, actions);
  card.append(title, meta, actions);
  return card;
}

function connectedAccountLabel(status) {
  const labels = {
    disconnected: "Not connected",
    connecting: "Connecting",
    connected: "Connected",
    error: "Needs attention",
  };
  return labels[status.state] || status.label || "Not connected";
}

function connectedAccountMeta(status) {
  if (status.connected) {
    const identity = status.email || "ChatGPT subscription connected";
    const models = Number.isInteger(status.model_count)
      ? `${status.model_count} model${status.model_count === 1 ? "" : "s"} available. `
      : "";
    const error = status.message ? `${status.message} ` : "";
    return `${identity}. ${models}${error}Restart your agent to refresh its model picker.`;
  }
  if (status.mode === "device" && status.user_code) {
    return `Enter code ${status.user_code} at ${status.verification_url}`;
  }
  if (status.state === "connecting") {
    return "Finish signing in, then return to this page.";
  }
  return status.message || "Connect a ChatGPT account to discover subscription models.";
}

function populateConnectedAccountActions(provider, status, actions) {
  const providerId = provider.provider_id;
  if (status.state === "connecting") {
    const target = status.authorization_url || status.verification_url;
    if (target) {
      actions.appendChild(authButton("Open sign-in", () => window.open(target, "_blank", "noopener")));
    }
    if (status.mode === "device" && status.user_code) {
      actions.appendChild(
        authButton(
          "Copy code",
          () => copyDeviceCode(status.user_code),
          "secondary-button",
        ),
      );
    }
    actions.appendChild(
      authButton("Cancel", () => cancelConnectedAccountLogin(providerId), "secondary-button"),
    );
    return;
  }
  if (status.connected) {
    actions.appendChild(
      authButton(
        "Reconnect",
        (button) => startConnectedAccountLogin(providerId, "browser", button),
      ),
    );
    actions.appendChild(
      authButton(
        "Disconnect",
        () => disconnectConnectedAccount(providerId),
        "secondary-button",
      ),
    );
    return;
  }
  actions.appendChild(
    authButton("Connect", (button) => startConnectedAccountLogin(providerId, "browser", button)),
    authButton(
      "Use device code",
      (button) => startConnectedAccountLogin(providerId, "device", button),
      "secondary-button",
    ),
  );
}

function authButton(label, action, className = "test-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => action(button));
  return button;
}

async function refreshConnectedAccounts() {
  const providers = (state.config?.provider_status || []).filter(
    (provider) => provider.kind === "connected_account",
  );
  await Promise.all(
    providers.map(async (provider) => {
      try {
        const status = await api(`/admin/api/providers/${provider.provider_id}/auth`);
        updateConnectedAccountCard(provider, status);
        if (status.state === "connecting") pollConnectedAccount(provider);
      } catch (error) {
        updateConnectedAccountCard(provider, {
          state: "error",
          connected: false,
          message: error.message,
        });
      }
    }),
  );
}

function updateConnectedAccountCard(provider, status) {
  const current = document.querySelector(
    `[data-provider="${provider.provider_id}"][data-connected-account="true"]`,
  );
  if (current) current.replaceWith(renderConnectedAccountCard(provider, status));
}

async function startConnectedAccountLogin(providerId, mode, button) {
  button.disabled = true;
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  try {
    const status = await api(`/admin/api/providers/${providerId}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    const provider = connectedAccountDescriptor(providerId);
    updateConnectedAccountCard(provider, status);
    const target = status.authorization_url || status.verification_url;
    if (target && popup) {
      popup.location.replace(target);
    } else if (target) {
      window.open(target, "_blank", "noopener");
    } else if (popup) {
      popup.close();
    }
    pollConnectedAccount(provider);
  } catch (error) {
    if (popup) popup.close();
    showMessage(error.message, true);
    button.disabled = false;
  }
}

async function cancelConnectedAccountLogin(providerId) {
  clearConnectedAccountPoll(providerId);
  const status = await api(`/admin/api/providers/${providerId}/auth/cancel`, {
    method: "POST",
  });
  updateConnectedAccountCard(connectedAccountDescriptor(providerId), status);
}

async function disconnectConnectedAccount(providerId) {
  if (!window.confirm("Disconnect this ChatGPT account from FCC?")) return;
  clearConnectedAccountPoll(providerId);
  const status = await api(`/admin/api/providers/${providerId}/auth`, {
    method: "DELETE",
  });
  updateConnectedAccountCard(connectedAccountDescriptor(providerId), status);
  await hydrateModelOptions();
}

function pollConnectedAccount(provider) {
  clearConnectedAccountPoll(provider.provider_id);
  const poll = async () => {
    try {
      const status = await api(`/admin/api/providers/${provider.provider_id}/auth`);
      updateConnectedAccountCard(provider, status);
      if (status.state === "connecting") {
        state.authPollers.set(provider.provider_id, window.setTimeout(poll, 1000));
      } else {
        state.authPollers.delete(provider.provider_id);
        if (status.connected) await hydrateModelOptions();
      }
    } catch (error) {
      state.authPollers.delete(provider.provider_id);
      showMessage(error.message, true);
    }
  };
  state.authPollers.set(provider.provider_id, window.setTimeout(poll, 1000));
}

function clearConnectedAccountPoll(providerId) {
  const timer = state.authPollers.get(providerId);
  if (timer) window.clearTimeout(timer);
  state.authPollers.delete(providerId);
}

function connectedAccountDescriptor(providerId) {
  return state.config.provider_status.find(
    (provider) => provider.provider_id === providerId,
  );
}

async function copyDeviceCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showMessage("Device code copied.");
  } catch {
    showMessage(`Copy this device code: ${code}`);
  }
}

function updateProviderCheckResult(providerId, status, message) {
  const card = document.querySelector(`[data-provider="${providerId}"]`);
  if (!card) return;
  const result = card.querySelector(".provider-check-result");
  result.className = `provider-check-result ${status}`;
  result.textContent = message;
  result.hidden = !message;
}

function renderSections(sections, fields) {
  state.modelComboboxes.clear();
  VIEW_GROUPS.forEach((view) => {
    const el = byId(view.containerId);
    if (el) el.innerHTML = "";
  });

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const bySection = new Map();
  sections.forEach((section) => bySection.set(section.id, []));
  fields.forEach((field) => {
    if (!bySection.has(field.section)) bySection.set(field.section, []);
    bySection.get(field.section).push(field);
  });

  VIEW_GROUPS.forEach((view) => {
    const container = byId(view.containerId);
    if (!container) return;
    view.sections.forEach((sectionId) => {
      const section = sectionById.get(sectionId);
      const sectionFields = bySection.get(sectionId) || [];
      if (!section || sectionFields.length === 0) return;

      const sectionEl = document.createElement("section");
      sectionEl.className = "settings-section";
      sectionEl.id = `section-${section.id}`;

      const heading = document.createElement("div");
      heading.className = "section-heading";
      heading.innerHTML = `<div><h3>${section.label}</h3><p>${section.description}</p></div>`;
      if (section.id === "models") {
        const refreshButton = document.createElement("button");
        refreshButton.type = "button";
        refreshButton.className = "secondary-button";
        refreshButton.textContent = "🔄 Actualizar Catálogo de Modelos";
        refreshButton.addEventListener("click", () => refreshModelOptions(refreshButton));
        heading.appendChild(refreshButton);
      }
      sectionEl.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "field-grid";
      sectionFields.forEach((field) => {
        grid.appendChild(renderField(field));
      });
      sectionEl.appendChild(grid);

      if (sectionFields.some((field) => field.advanced)) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "ghost-button advanced-toggle";
        toggle.textContent = "⚙️ Mostrar Opciones Avanzadas";
        toggle.addEventListener("click", () => {
          const showing = sectionEl.classList.toggle("show-advanced");
          toggle.textContent = showing ? "⚙️ Ocultar Opciones Avanzadas" : "⚙️ Mostrar Opciones Avanzadas";
        });
        sectionEl.appendChild(toggle);
      }

      container.appendChild(sectionEl);
    });
  });
}

function getModelSpecsLocal(modelSlug) {
  const m = (modelSlug || "").toLowerCase();
  let context = "128k";
  const caps = [];
  
  if (m.includes("gemini")) {
    context = "1M - 2M";
    caps.push("👁️ Visión", "🛠️ Tools", "🧠 Thinking");
  } else if (m.includes("claude-3-7") || m.includes("claude-3.7")) {
    context = "200k";
    caps.push("👁️ Visión", "🛠️ Tools", "🧠 Thinking Híbrido");
  } else if (m.includes("claude-3-5") || m.includes("sonnet")) {
    context = "200k";
    caps.push("👁️ Visión", "🛠️ Tools", "⚡ Alta Velocidad");
  } else if (m.includes("deepseek-r1") || m.includes("r1")) {
    context = "64k - 128k";
    caps.push("🧠 Razonamiento R1", "🛠️ Tools");
  } else if (m.includes("llama-3.3") || m.includes("llama-3.1") || m.includes("nemotron")) {
    context = "128k";
    caps.push("🛠️ Tools", "⚡ Inferencia Rápida");
  } else if (m.includes("gpt-4o") || m.includes("omni")) {
    context = "128k";
    caps.push("👁️ Visión", "🎙️ Audio", "🛠️ Tools");
  } else {
    context = "128k";
    caps.push("🛠️ Tools");
  }
  return { context, caps };
}

function renderModelRouteHealthCard(field, input) {
  const card = document.createElement("div");
  card.className = "model-route-health-card";
  card.dataset.routeKey = field.key;

  const updateCard = () => {
    const val = input.value.trim();
    const isOptional = field.type === "optional_model";
    const isInherited = isOptional && (!val || val.toLowerCase() === "none");
    
    let effectiveVal = val;
    if (isInherited) {
      const defaultInput = byId("field-MODEL");
      effectiveVal = defaultInput ? defaultInput.value.trim() : (state.fields?.get("MODEL")?.value || "");
    }

    const parts = (effectiveVal || "").split("/");
    const providerId = parts[0] || "";
    const modelName = parts.slice(1).join("/") || effectiveVal;

    const providerObj = (state.config?.provider_status || []).find(
      (p) => p.provider_id === providerId
    );
    const isConfigured = providerObj && ["configured", "reachable", "running", "connected"].includes(providerObj.status);
    const isMissingKey = providerObj && ["missing_key", "missing_config", "missing_url"].includes(providerObj.status);

    card.innerHTML = "";
    
    const header = document.createElement("div");
    header.className = "route-health-header";

    const badgeWrap = document.createElement("div");
    badgeWrap.className = "route-health-badge-wrap";

    const provTag = document.createElement("span");
    provTag.className = "route-provider-tag";
    provTag.textContent = providerObj ? (providerObj.display_name || providerId) : (providerId || "Enrutador FCC");
    badgeWrap.appendChild(provTag);

    const statusBadge = document.createElement("span");
    if (isInherited) {
      card.className = "model-route-health-card status-warn";
      statusBadge.className = "route-health-status warn";
      statusBadge.textContent = "🟡 Hereda Modelo Principal";
    } else if (isConfigured) {
      card.className = "model-route-health-card status-ok";
      statusBadge.className = "route-health-status ok";
      statusBadge.textContent = "🟢 Operativo en Enrutador";
    } else if (isMissingKey) {
      card.className = "model-route-health-card status-error";
      statusBadge.className = "route-health-status error";
      statusBadge.textContent = "🔴 Falta API Key";
    } else {
      card.className = "model-route-health-card status-ok";
      statusBadge.className = "route-health-status ok";
      statusBadge.textContent = "⚡ Ruta Configurada";
    }
    badgeWrap.appendChild(statusBadge);
    header.appendChild(badgeWrap);

    const specs = getModelSpecsLocal(modelName || effectiveVal);
    const chipsWrap = document.createElement("div");
    chipsWrap.className = "route-specs-chips";

    const ctxChip = document.createElement("span");
    ctxChip.className = "route-spec-chip context-chip";
    ctxChip.textContent = `🪟 ${specs.context}`;
    chipsWrap.appendChild(ctxChip);

    specs.caps.forEach((cap) => {
      const capChip = document.createElement("span");
      capChip.className = "route-spec-chip active-cap";
      capChip.textContent = cap;
      chipsWrap.appendChild(capChip);
    });
    header.appendChild(chipsWrap);
    card.appendChild(header);

    const actionRow = document.createElement("div");
    actionRow.className = "route-test-action-wrap";

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn-test-route";
    testBtn.innerHTML = "⚡ Probar Conexión en Vivo";

    const resultMsg = document.createElement("span");
    resultMsg.className = "route-test-result";

    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testBtn.innerHTML = "⏳ Verificando...";
      resultMsg.className = "route-test-result";
      resultMsg.textContent = "";
      const startTime = performance.now();
      try {
        if (providerId) {
          const testRes = await api(`/admin/api/providers/${providerId}/test`, {
            method: "POST",
            body: "{}",
          });
          const elapsed = Math.round(performance.now() - startTime);
          if (testRes.ok) {
            resultMsg.className = "route-test-result ok";
            resultMsg.textContent = `🟢 Conexión OK · ${elapsed}ms (${testRes.models?.length || 0} modelos disponibles)`;
          } else {
            resultMsg.className = "route-test-result error";
            resultMsg.textContent = `🔴 Error: ${testRes.message || "Fallo de respuesta"}`;
          }
        } else {
          resultMsg.className = "route-test-result ok";
          resultMsg.textContent = "🟢 Enrutador listo";
        }
      } catch (err) {
        resultMsg.className = "route-test-result error";
        resultMsg.textContent = `❌ ${err.message || "Error al conectar"}`;
      } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = "⚡ Probar Conexión en Vivo";
      }
    });

    actionRow.appendChild(testBtn);

    if (isMissingKey && providerObj) {
      const configKeyBtn = document.createElement("button");
      configKeyBtn.type = "button";
      configKeyBtn.className = "btn-config-key-inline";
      configKeyBtn.textContent = `🔑 Configurar Clave de ${providerObj.display_name || providerId}`;
      configKeyBtn.addEventListener("click", () => {
        openDirectProviderConfigModal(providerObj, true);
      });
      actionRow.appendChild(configKeyBtn);
    }

    actionRow.appendChild(resultMsg);
    card.appendChild(actionRow);
  };

  input.addEventListener("input", updateCard);
  input.addEventListener("change", updateCard);
  setTimeout(updateCard, 10);
  return card;
}

function renderField(field) {
  const wrapper = document.createElement("div");
  wrapper.className = `field${field.advanced ? " advanced-field" : ""}`;
  wrapper.dataset.key = field.key;

  const label = document.createElement("label");
  label.htmlFor = `field-${field.key}`;
  const labelText = document.createElement("span");
  labelText.textContent = field.label;
  label.appendChild(labelText);

  const source = sourceText(field);
  if (source) {
    const sourceEl = document.createElement("span");
    sourceEl.className = "field-source";
    sourceEl.textContent = source;
    label.appendChild(sourceEl);
  }

  const input = inputForField(field);
  input.id = `field-${field.key}`;
  input.dataset.key = field.key;
  input.dataset.original = comparableValue(field.value);
  input.dataset.secret = field.secret ? "true" : "false";
  input.dataset.configured = field.configured ? "true" : "false";
  input.dataset.nullable = field.nullable ? "true" : "false";
  input.dataset.remove = "false";
  input.dataset.fieldType = field.type;
  input.disabled = field.locked;
  input.addEventListener("input", updateDirtyState);
  input.addEventListener("change", updateDirtyState);
  input.addEventListener("input", () => {
    input.dataset.remove = "false";
  });
  if (field.type === "optional_model") {
    input.addEventListener("blur", () => {
      if (!input.value.trim() || input.value.trim().toLowerCase() === "none") {
        input.value = "None";
        updateDirtyState();
      }
    });
  }

  let control = input;
  if (field.type === "model" || field.type === "optional_model") {
    control = createModelCombobox(input, field).element;
  } else if (field.type === "model_list") {
    const editor = new ModelListEditor(input, field);
    label.htmlFor = editor.inputId;
    control = editor.element;
  }
  wrapper.append(label, control);

  if (["MODEL", "MODEL_SONNET", "MODEL_OPUS", "MODEL_HAIKU", "MODEL_FABLE"].includes(field.key)) {
    const healthCard = renderModelRouteHealthCard(field, input);
    wrapper.appendChild(healthCard);
  }

  if (field.secret && field.nullable && field.configured && !field.locked) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost-button secret-remove";
    removeButton.textContent = "🗑 Quitar";
    removeButton.addEventListener("click", () => {
      const removing = input.dataset.remove !== "true";
      input.dataset.remove = removing ? "true" : "false";
      input.readOnly = removing;
      removeButton.textContent = removing ? "↩ Deshacer eliminación" : "🗑 Quitar";
      updateDirtyState();
    });
    wrapper.appendChild(removeButton);
  }
  if (field.description) {
    const description = document.createElement("div");
    description.className = "field-description";
    description.textContent = field.description;
    wrapper.appendChild(description);
  }
  return wrapper;
}

function inputForField(field) {
  if (field.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = String(field.value).toLowerCase() === "true";
    input.dataset.original = input.checked ? "true" : "false";
    return input;
  }

  if (field.type === "select") {
    const select = document.createElement("select");
    field.options.forEach((item) =>
      select.appendChild(option(item.value, item.label)),
    );
    select.value = field.value || field.options[0]?.value || "";
    return select;
  }

  if (field.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.value = field.value || "";
    return textarea;
  }

  if (field.type === "model" || field.type === "optional_model") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = field.value || (field.type === "optional_model" ? "None" : "");
    input.autocomplete = "off";
    return input;
  }

  if (field.type === "model_list") {
    const input = document.createElement("input");
    input.type = "hidden";
    input.value = field.value || "";
    return input;
  }

  const input = document.createElement("input");
  input.type = field.type === "number" ? "number" : "text";
  if (field.type === "secret") {
    input.type = "password";
    input.placeholder = field.configured
      ? "Configurado (introduce un nuevo valor para reemplazar)"
      : "No configurado";
    input.value = "";
    input.autocomplete = "off";
  } else {
    input.value = field.value || "";
  }
  return input;
}

function createModelCombobox(input, field) {
  return new window.FccModelCombobox(input, {
    listboxId: `model-options-${field.key}`,
    label: field.label,
    values: () =>
      field.type === "optional_model"
        ? ["None", ...state.modelOptions]
        : state.modelOptions,
    emptyMessage: () =>
      state.modelOptions.length
        ? "No matching models. You can still enter a custom slug."
        : "No discovered models. Refresh models or enter a custom slug.",
    registry: state.modelComboboxes,
  });
}

class ModelListEditor {
  constructor(input, field) {
    this.input = input;
    this.field = field;
    this.values = input.value
      ? input.value.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    this.inputId = `field-${field.key}-add`;

    this.element = document.createElement("div");
    this.element.className = "model-list-editor";

    const addRow = document.createElement("div");
    addRow.className = "model-list-add";
    this.addInput = document.createElement("input");
    this.addInput.id = this.inputId;
    this.addInput.type = "text";
    this.addInput.autocomplete = "off";
    this.addInput.placeholder = "proveedor/modelo (ej: open_router/meta/llama-3.3-70b-instruct)";
    this.addInput.disabled = field.locked;
    const addCombobox = createModelCombobox(this.addInput, {
      ...field,
      key: `${field.key}-add`,
      label: "modelo de respaldo",
      type: "model",
    });

    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "secondary-button";
    this.addButton.textContent = "➕ Agregar Respaldo";
    this.addButton.disabled = field.locked;
    this.addButton.addEventListener("click", () => this.add());
    addRow.append(addCombobox.element, this.addButton);

    this.rows = document.createElement("div");
    this.rows.className = "model-list-rows";
    this.element.append(input, addRow, this.rows);
    this.renderRows();
  }

  add() {
    const value = this.addInput.value.trim();
    if (!value) {
      showMessage("Introduce un modelo de respaldo completo (ej: open_router/meta/llama-3.3-70b-instruct).", "error");
      return;
    }
    if (this.values.includes(value)) {
      showMessage("Ese modelo de respaldo ya está en la lista.", "error");
      return;
    }
    this.values.push(value);
    this.addInput.value = "";
    showMessage("");
    this.sync();
  }

  move(index, offset) {
    const destination = index + offset;
    if (destination < 0 || destination >= this.values.length) return;
    [this.values[index], this.values[destination]] = [
      this.values[destination],
      this.values[index],
    ];
    this.sync();
  }

  remove(index) {
    this.values.splice(index, 1);
    this.sync();
  }

  sync() {
    this.input.value = this.values.join(",");
    this.input.dataset.remove = "false";
    this.input.dispatchEvent(new Event("input", { bubbles: true }));
    this.renderRows();
  }

  renderRows() {
    this.rows.innerHTML = "";
    if (this.values.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-list-empty";
      empty.textContent = "No hay modelos de respaldo configurados. Agrega uno arriba para failover automático.";
      this.rows.appendChild(empty);
      return;
    }

    this.values.forEach((value, index) => {
      const row = document.createElement("div");
      row.className = "model-list-row";

      const model = document.createElement("span");
      model.className = "model-list-value";
      model.textContent = value;

      const up = this.actionButton("⬆ Subir", `Subir ${value}`, () =>
        this.move(index, -1),
      );
      up.disabled = this.field.locked || index === 0;
      const down = this.actionButton("⬇ Bajar", `Bajar ${value}`, () =>
        this.move(index, 1),
      );
      down.disabled = this.field.locked || index === this.values.length - 1;
      const remove = this.actionButton("🗑 Quitar", `Quitar ${value}`, () =>
        this.remove(index),
      );
      remove.disabled = this.field.locked;

      row.append(model, up, down, remove);
      this.rows.appendChild(row);
    });
  }

  actionButton(text, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button model-list-action";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    return button;
  }
}

function option(value, label) {
  const optionEl = document.createElement("option");
  optionEl.value = value;
  optionEl.textContent = label;
  return optionEl;
}

function readFieldValue(input) {
  if (input.type === "checkbox") return input.checked ? "true" : "false";
  if (input.dataset.remove === "true") return null;
  if (
    input.dataset.fieldType === "optional_model" &&
    input.value.trim().toLowerCase() === "none"
  ) {
    return null;
  }
  if (input.dataset.secret === "true" && input.dataset.configured === "true") {
    return input.value ? input.value : MASKED_SECRET;
  }
  if (input.dataset.nullable === "true" && !input.value.trim()) return null;
  return input.value;
}

function comparableValue(value) {
  return value === null ? NULL_VALUE : String(value);
}

function changedValues() {
  const values = {};
  document.querySelectorAll("[data-key]").forEach((input) => {
    if (input.disabled || !input.matches("input, select, textarea")) return;
    const value = readFieldValue(input);
    if (comparableValue(value) !== input.dataset.original) {
      values[input.dataset.key] = value;
    }
  });
  return values;
}

function updateDirtyState() {
  const count = Object.keys(changedValues()).length;
  byId("dirtyState").textContent =
    count === 0 ? "Sin cambios pendientes" : `${count} cambio${count === 1 ? "" : "s"} sin guardar`;
  byId("applyButton").disabled = count === 0;
}

async function apply() {
  const result = await api("/admin/api/config/apply", {
    method: "POST",
    body: JSON.stringify({ values: changedValues() }),
  });
  if (!result.applied) {
    showMessage(`Error: ${result.errors.join("; ")}`, "error");
    return;
  }
  const restart = result.restart || {};
  if (restart.required && restart.automatic) {
    showMessage("✅ Cambios guardados. Reiniciando el servidor Enrutador...", "ok");
    byId("applyButton").disabled = true;
    setTimeout(() => {
      window.location.href = restart.admin_url || "/admin";
    }, 1600);
    return;
  }
  const pending = restart.required ? restart.fields || [] : result.pending_fields || [];
  await load();
  showMessage(
    pending.length
      ? `✅ Configuración aplicada. Reinicia fcc-server para activar: ${pending.join(", ")}`
      : "✅ Configuración guardada y aplicada con éxito.",
    "ok",
  );
}

async function refreshLocalStatus() {
  const result = await api("/admin/api/providers/local-status");
  result.providers.forEach((provider) => {
    if (provider.status === "missing_url") return;
    if (provider.status === "reachable") {
      updateProviderCheckResult(
        provider.provider_id,
        "ok",
        `🟢 Conectado: ${provider.base_url}`,
      );
      return;
    }
    const detail = provider.message
      ? provider.message
      : provider.status_code
        ? `${provider.base_url} retornó HTTP ${provider.status_code}`
        : "El proveedor local no respondió.";
    updateProviderCheckResult(
      provider.provider_id,
      "error",
      `🔴 No disponible: ${detail}`,
    );
  });
}

async function testProvider(providerId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "⏳ Verificando...";
  updateProviderCheckResult(providerId, "checking", "⏳ Verificando...");
  try {
    const result = await api(`/admin/api/providers/${providerId}/test`, {
      method: "POST",
      body: "{}",
    });
    if (result.ok) {
      updateProviderCheckResult(
        providerId,
        "ok",
        `🟢 ${result.models.length} modelos disponibles y listos`,
      );
      setModelOptions([
        ...state.modelOptions,
        ...result.models.map((model) => `${providerId}/${model}`),
      ]);
    } else {
      updateProviderCheckResult(
        providerId,
        "error",
        `🔴 No disponible: ${result.message || "Fallo al verificar proveedor."}`,
      );
    }
  } catch {
    updateProviderCheckResult(
      providerId,
      "error",
      "🔴 No se pudo completar la verificación del proveedor.",
    );
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function hydrateModelOptions() {
  try {
    await loadModelOptions();
  } catch {
    // Model fields remain editable when optional catalog hydration is unavailable.
  }
}

async function loadModelOptions(refresh = false) {
  const result = await api("/admin/api/models" + (refresh ? "/refresh" : ""), {
    method: refresh ? "POST" : "GET",
  });
  setModelOptions(result.models);
  if (refresh && window.ChatSessions) await window.ChatSessions.refresh();
  return result;
}

async function refreshModelOptions(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "⏳ Actualizando...";
  try {
    const result = await loadModelOptions(true);
    const failedProviders = result.failed_providers || [];
    if (failedProviders.length) {
      const labels = failedProviders.map(providerDisplayName).join(", ");
      showMessage(
        `Catálogo actualizado: ${state.modelOptions.length} modelos disponibles; no se pudo sincronizar con: ${labels}`,
        "warn",
      );
    } else {
      showMessage(`✅ Catálogo actualizado: ${state.modelOptions.length} modelos disponibles y listos`, "ok");
    }
  } catch (error) {
    showMessage(`Error al actualizar modelos: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function providerDisplayName(providerId) {
  const provider = state.config?.provider_status?.find(
    (candidate) => candidate.provider_id === providerId,
  );
  return provider?.display_name || providerId;
}

function setModelOptions(models) {
  state.modelOptions = Array.from(
    new Set(models.filter((model) => typeof model === "string" && model.trim())),
  ).sort((left, right) => left.localeCompare(right));
  state.modelComboboxes.forEach((combobox) => {
    if (combobox.isOpen) combobox.render(combobox.query);
  });
}

async function updateModelTelemetryKpis() {
  try {
    const data = await api("/admin/api/telemetry");
    const totalTokensEl = byId("kpiTotalTokens");
    const tpmEl = byId("kpiTpm");
    const cpmEl = byId("kpiCpm");
    const latencyEl = byId("kpiLatency");
    const activeModelEl = byId("kpiActiveModel");
    const activeProviderEl = byId("kpiActiveProvider");

    if (totalTokensEl) totalTokensEl.textContent = (data.total_tokens || 0).toLocaleString();
    if (tpmEl) tpmEl.textContent = `${(data.tokens_per_minute || 0).toLocaleString()} TPM`;
    if (cpmEl) cpmEl.textContent = `${data.requests_per_minute || 0} req/min`;
    if (latencyEl) latencyEl.textContent = `${data.avg_latency_ms || 0} ms`;
    if (activeModelEl) activeModelEl.textContent = data.current_model || "Por defecto";
    if (activeProviderEl) {
      const pObj = (state.config?.provider_status || []).find((p) => p.provider_id === data.current_provider);
      activeProviderEl.textContent = pObj ? `Proveedor: ${pObj.display_name}` : `Proveedor: ${data.current_provider}`;
    }
  } catch {
    // Telemetry updates quietly if offline
  }
}

function showMessage(message, kind = "") {
  const area = byId("messageArea");
  area.textContent = message;
  area.className = `message-area ${kind}`.trim();
}

byId("applyButton").addEventListener("click", apply);
document.addEventListener("pointerdown", (event) => {
  state.modelComboboxes.forEach((combobox) => {
    if (combobox.isOpen && !combobox.element.contains(event.target)) combobox.close();
  });
});

window.addEventListener("popstate", () => {
  const viewId = window.location.pathname.startsWith("/admin/chat")
    ? "chat"
    : "providers";
  setActiveView(viewId, { scroll: false });
});

setInterval(() => {
  if (state.activeView === "model_config") {
    updateModelTelemetryKpis();
  }
}, 2500);

load().catch((error) => {
  showMessage(error.message, "error");
});
