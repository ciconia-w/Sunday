#include "hostqt/channels/serviceconfigchannel.h"
#include "hostqt/sidecarclient.h"

#include <QJsonArray>

namespace hostqt {

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

} // namespace hostqt
