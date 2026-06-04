#include "hostqt/channels/serviceconfigchannel.h"
#include "hostqt/sidecarclient.h"

#include <QJsonArray>

namespace hostqt {

namespace {

QJsonObject defaultBrowserControlState()
{
    return QJsonObject{
        {QStringLiteral("enabled"), false},
        {QStringLiteral("daemonRunning"), false},
        {QStringLiteral("extensionConnected"), false},
        {QStringLiteral("daemonLabel"), QStringLiteral("未运行")},
        {QStringLiteral("extensionLabel"), QStringLiteral("未连接")},
        {QStringLiteral("version"), QString()},
        {QStringLiteral("statusSummary"), QStringLiteral("浏览器控制已关闭")},
        {QStringLiteral("extensionPath"), QString()},
        {QStringLiteral("outputDir"), QString()},
        {QStringLiteral("sessionName"), QStringLiteral("sunday")},
        {QStringLiteral("repoRoot"), QString()},
    };
}

QJsonObject defaultBrowserPanelState()
{
    QJsonObject state = defaultBrowserControlState();
    state.insert(QStringLiteral("url"), QString());
    state.insert(QStringLiteral("title"), QString());
    state.insert(QStringLiteral("interactive"), 0);
    state.insert(QStringLiteral("tabs"), QJsonArray());
    return state;
}

QJsonObject defaultBrowserStartState()
{
    QJsonObject state = defaultBrowserControlState();
    state.insert(QStringLiteral("started"), false);
    state.insert(QStringLiteral("reason"), QStringLiteral("disabled"));
    return state;
}

QJsonObject defaultBrowserActionResult(const QString &error = QStringLiteral("sidecar unavailable"))
{
    return QJsonObject{
        {QStringLiteral("ok"), false},
        {QStringLiteral("message"), QString()},
        {QStringLiteral("error"), error},
        {QStringLiteral("errorKind"), QStringLiteral("unavailable")},
        {QStringLiteral("errorHint"), error},
    };
}

QJsonObject defaultBrowserExtractResult(const QString &error = QStringLiteral("sidecar unavailable"))
{
    QJsonObject result = defaultBrowserActionResult(error);
    result.insert(QStringLiteral("content"), QString());
    return result;
}

QJsonObject defaultBrowserScreenshotResult(const QString &error = QStringLiteral("sidecar unavailable"))
{
    QJsonObject result = defaultBrowserActionResult(error);
    result.insert(QStringLiteral("screenshotPath"), QString());
    return result;
}

} // namespace

ServiceConfigChannel::ServiceConfigChannel(QObject *parent)
    : QObject(parent)
{
}

void ServiceConfigChannel::setSidecarClient(SidecarClient *client)
{
    m_sidecarClient = client;
}

bool ServiceConfigChannel::checkKnowledgeBase() const { return false; }
bool ServiceConfigChannel::checkEmbeddingPlugins() const { return false; }
bool ServiceConfigChannel::isMcpRuntimeReady() const
{
    if (!m_sidecarClient) {
        return false;
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/is-mcp-runtime-ready"), QVariantMap()).toBool();
}
bool ServiceConfigChannel::checkDocumentConversionCapability() const { return true; }
QJsonObject ServiceConfigChannel::getRuntimeStatus() const
{
    if (!m_sidecarClient) {
        return QJsonObject{
            {QStringLiteral("provider"), QStringLiteral("unknown")},
            {QStringLiteral("modelId"), QStringLiteral("unknown")},
            {QStringLiteral("mode"), QStringLiteral("demo")},
            {QStringLiteral("modeReason"), QStringLiteral("sidecar unavailable")},
        };
    }

    const QJsonObject root = m_sidecarClient->getStateSync();
    return root.value(QStringLiteral("runtime")).toObject();
}
QJsonArray ServiceConfigChannel::getCliToolsState() const
{
    if (!m_sidecarClient) {
        return QJsonArray();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/get-cli-tools-state"), QVariantMap()).toArray();
}
QJsonObject ServiceConfigChannel::getBrowserControlState() const
{
    if (!m_sidecarClient) {
        return defaultBrowserControlState();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/get-browser-control-state"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::setBrowserControlEnabled(bool enabled) const
{
    if (!m_sidecarClient) {
        return QJsonObject{{QStringLiteral("enabled"), enabled}};
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/set-browser-control-enabled"),
        QVariantMap{{QStringLiteral("enabled"), enabled}}).toObject();
}
QJsonObject ServiceConfigChannel::getBrowserPanelState() const
{
    if (!m_sidecarClient) {
        return defaultBrowserPanelState();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/get-browser-panel-state"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::startBrowserSessionIfEnabled() const
{
    if (!m_sidecarClient) {
        return defaultBrowserStartState();
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/start-browser-session-if-enabled"),
        QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::initBrowserSession() const
{
    if (!m_sidecarClient) {
        return defaultBrowserPanelState();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/init-browser-session"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::browserOpenUrl(const QString &url) const
{
    if (!m_sidecarClient) {
        return defaultBrowserActionResult();
    }

    QString errorMessage;
    const QJsonValue result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/browser-open-url"),
        QVariantMap{{QStringLiteral("url"), url}},
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        return defaultBrowserActionResult(errorMessage);
    }

    if (result.isObject()) {
        const QJsonObject payload = result.toObject();
        if (payload.contains(QStringLiteral("ok"))) {
            return payload;
        }
    }

    return QJsonObject{
        {QStringLiteral("ok"), true},
        {QStringLiteral("message"), result.toString()},
        {QStringLiteral("error"), QString()},
    };
}
QJsonObject ServiceConfigChannel::browserNewTab(const QString &url) const
{
    if (!m_sidecarClient) {
        return defaultBrowserActionResult();
    }

    QString errorMessage;
    const QJsonValue result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/browser-new-tab"),
        QVariantMap{{QStringLiteral("url"), url}},
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        return defaultBrowserActionResult(errorMessage);
    }

    if (result.isObject()) {
        const QJsonObject payload = result.toObject();
        if (payload.contains(QStringLiteral("ok"))) {
            return payload;
        }
    }

    return QJsonObject{
        {QStringLiteral("ok"), true},
        {QStringLiteral("message"), result.toString()},
        {QStringLiteral("error"), QString()},
    };
}
QJsonObject ServiceConfigChannel::browserSelectTab(const QString &pageId) const
{
    if (!m_sidecarClient) {
        return defaultBrowserActionResult();
    }

    QString errorMessage;
    const QJsonValue result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/browser-select-tab"),
        QVariantMap{{QStringLiteral("pageId"), pageId}},
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        return defaultBrowserActionResult(errorMessage);
    }

    if (result.isObject()) {
        const QJsonObject payload = result.toObject();
        if (payload.contains(QStringLiteral("ok"))) {
            return payload;
        }
    }

    return QJsonObject{
        {QStringLiteral("ok"), true},
        {QStringLiteral("message"), result.toString()},
        {QStringLiteral("error"), QString()},
    };
}
QJsonObject ServiceConfigChannel::browserExtractPage() const
{
    if (!m_sidecarClient) {
        return defaultBrowserExtractResult();
    }

    QString errorMessage;
    const QJsonValue result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/browser-extract-page"),
        QVariantMap(),
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        return defaultBrowserExtractResult(errorMessage);
    }

    if (result.isObject()) {
        const QJsonObject payload = result.toObject();
        if (payload.contains(QStringLiteral("ok"))) {
            return payload;
        }
    }

    return QJsonObject{
        {QStringLiteral("ok"), true},
        {QStringLiteral("content"), result.toString()},
        {QStringLiteral("error"), QString()},
    };
}
QJsonObject ServiceConfigChannel::browserCaptureScreenshot(const QString &outputPath) const
{
    if (!m_sidecarClient) {
        return defaultBrowserScreenshotResult();
    }

    QString errorMessage;
    const QJsonObject result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/browser-capture-screenshot"),
        QVariantMap{{QStringLiteral("outputPath"), outputPath}},
        &errorMessage).toObject();
    if (!errorMessage.isEmpty()) {
        return defaultBrowserScreenshotResult(errorMessage);
    }

    if (result.contains(QStringLiteral("ok")) && !result.value(QStringLiteral("ok")).toBool(true)) {
        return result;
    }

    QJsonObject payload = result;
    payload.insert(QStringLiteral("ok"), true);
    payload.insert(QStringLiteral("error"), QString());
    return payload;
}
QJsonObject ServiceConfigChannel::getModelConfig() const
{
    if (!m_sidecarClient) {
        return QJsonObject{
            {QStringLiteral("provider"), QStringLiteral("openai")},
            {QStringLiteral("model"), QStringLiteral("gpt-5.4-mini")},
            {QStringLiteral("availableModels"), QJsonArray{QStringLiteral("gpt-5.4-mini")}},
            {QStringLiteral("providerOptions"), QJsonArray()},
            {QStringLiteral("providerApiKeyEnv"), QStringLiteral("OPENAI_API_KEY")},
            {QStringLiteral("providerApiKey"), QString()},
            {QStringLiteral("hasConfiguredKey"), false},
            {QStringLiteral("mode"), QStringLiteral("demo")},
            {QStringLiteral("modeReason"), QStringLiteral("sidecar unavailable")},
        };
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/model-config/get"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::saveModelConfig(
    const QString &provider,
    const QString &model,
    const QString &availableModels,
    const QString &providerApiKey) const
{
    if (!m_sidecarClient) {
        return QJsonObject();
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/model-config/save"),
        QVariantMap{
            {QStringLiteral("provider"), provider},
            {QStringLiteral("model"), model},
            {QStringLiteral("availableModels"), availableModels},
            {QStringLiteral("providerApiKey"), providerApiKey},
        }).toObject();
}
bool ServiceConfigChannel::getMcpThirdPartyAgreement() const
{
    if (!m_sidecarClient) {
        return false;
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/get-mcp-third-party-agreement"), QVariantMap()).toBool();
}
void ServiceConfigChannel::setMcpThirdPartyAgreement(bool agreed)
{
    if (!m_sidecarClient) {
        return;
    }

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/set-mcp-third-party-agreement"),
        QVariantMap{{QStringLiteral("accepted"), agreed}});
}
QJsonObject ServiceConfigChannel::getMcpServices() const
{
    if (!m_sidecarClient) {
        QJsonObject root;
        root.insert("success", true);
        root.insert("services", QJsonArray());
        return root;
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/get-mcp-services"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::refreshMcpRuntime() const
{
    if (!m_sidecarClient) {
        QJsonObject root;
        root.insert("success", true);
        root.insert("services", QJsonArray());
        return root;
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/service-config/refresh-mcp-runtime"), QVariantMap()).toObject();
}
QJsonObject ServiceConfigChannel::setMcpServiceEnabled(const QString &serviceId, bool enabled) const
{
    if (!m_sidecarClient) {
        return QJsonObject();
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/set-mcp-service-enabled"),
        QVariantMap{
            {QStringLiteral("serviceId"), serviceId},
            {QStringLiteral("enabled"), enabled},
        }).toObject();
}
QJsonObject ServiceConfigChannel::saveMcpService(const QString &jsonConfig, const QString &description, const QString &serviceId) const
{
    if (!m_sidecarClient) {
        return QJsonObject();
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/save-mcp-service"),
        QVariantMap{
            {QStringLiteral("jsonConfig"), jsonConfig},
            {QStringLiteral("description"), description},
            {QStringLiteral("serviceId"), serviceId},
        }).toObject();
}
QJsonObject ServiceConfigChannel::deleteMcpService(const QString &serviceId) const
{
    if (!m_sidecarClient) {
        return QJsonObject();
    }

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/service-config/delete-mcp-service"),
        QVariantMap{{QStringLiteral("serviceId"), serviceId}}).toObject();
}
bool ServiceConfigChannel::installApp(const QString &) const
{
    return false;
}

} // namespace hostqt
