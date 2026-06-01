#include "hostqt/channels/assistantchannel.h"
#include "hostqt/sidecarclient.h"

#include <QJsonDocument>

namespace hostqt {

AssistantChannel::AssistantChannel(QObject *parent)
    : QObject(parent)
{
}

void AssistantChannel::setSidecarClient(SidecarClient *client)
{
    m_sidecarClient = client;
}

QJsonArray AssistantChannel::getAssistantList() const
{
    if (!m_sidecarClient)
        return QJsonArray();

    const QJsonObject root = m_sidecarClient->getStateSync();
    return root.value(QStringLiteral("assistants")).toArray();
}

QString AssistantChannel::getCurrentModel(const QString &) const
{
    if (!m_sidecarClient)
        return QString();

    const QJsonObject root = m_sidecarClient->getStateSync();
    return root.value(QStringLiteral("currentModelId")).toString();
}

QJsonArray AssistantChannel::getModelList(const QString &assistantId) const
{
    if (!m_sidecarClient)
        return QJsonArray();

    const QJsonObject root = m_sidecarClient->getStateSync();
    const QJsonObject modelMap = root.value(QStringLiteral("modelsByAssistant")).toObject();
    return modelMap.value(assistantId).toArray();
}

bool AssistantChannel::setCurrentModel(const QString &modelId, const QString &assistantId)
{
    if (!m_sidecarClient)
        return false;

    const QJsonValue result = m_sidecarClient->postJsonValueSync(
        QStringLiteral("/assistant/set-current-model"),
        QVariantMap{
            {QStringLiteral("modelId"), modelId},
            {QStringLiteral("assistantId"), assistantId},
        });

    if (result.toBool()) {
        emit modelListChanged();
    }

    return result.toBool();
}
QJsonArray AssistantChannel::getAssistantOrder() const { return QJsonArray(); }
void AssistantChannel::setAssistantOrder(const QJsonArray &) {}
int AssistantChannel::getAssistantVisibleCount() const { return 4; }
void AssistantChannel::setAssistantVisibleCount(int) {}
QString AssistantChannel::getRecentWritingDocs() const
{
    if (!m_sidecarClient)
        return QStringLiteral("[]");

    const QJsonObject root = m_sidecarClient->getStateSync();
    return QString::fromUtf8(QJsonDocument(root.value(QStringLiteral("recentWritingDocs")).toArray()).toJson(QJsonDocument::Compact));
}

QString AssistantChannel::getWritingTemplates() const
{
    if (!m_sidecarClient)
        return QStringLiteral("[]");

    const QJsonObject root = m_sidecarClient->getStateSync();
    return QString::fromUtf8(QJsonDocument(root.value(QStringLiteral("writingTemplates")).toArray()).toJson(QJsonDocument::Compact));
}
QString AssistantChannel::getTranslationFAQ() const { return QStringLiteral("[]"); }
QString AssistantChannel::getClawFAQ() const { return QStringLiteral("[]"); }
void AssistantChannel::requestAddModel() {}
void AssistantChannel::claimUsageRequest(const QString &) {}

} // namespace hostqt
