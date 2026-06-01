#include "hostqt/channels/conversationchannel.h"
#include "hostqt/sidecarclient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonValue>

namespace hostqt {

ConversationChannel::ConversationChannel(QObject *parent)
    : QObject(parent)
{
}

void ConversationChannel::setSidecarClient(SidecarClient *client)
{
    m_sidecarClient = client;
}

QJsonObject ConversationChannel::getConversation(const QString &id) const
{
    if (!m_sidecarClient)
        return QJsonObject();

    return m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/get"),
        QVariantMap{{QStringLiteral("id"), id}})
        .toObject();
}

void ConversationChannel::deleteConversation(const QStringList &ids)
{
    if (!m_sidecarClient)
        return;

    QVariantList list;
    for (const QString &id : ids)
        list.push_back(id);

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/delete"),
        QVariantMap{{QStringLiteral("ids"), list}});
}

void ConversationChannel::releaseConversation(const QStringList &ids)
{
    if (!m_sidecarClient)
        return;

    QVariantList list;
    for (const QString &id : ids)
        list.push_back(id);

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/release"),
        QVariantMap{{QStringLiteral("ids"), list}});
}

bool ConversationChannel::saveConversation(const QString &id)
{
    if (!m_sidecarClient)
        return false;

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/conversation/save"),
               QVariantMap{{QStringLiteral("id"), id}})
        .toBool();
}

QString ConversationChannel::getConversationIndexes() const
{
    if (!m_sidecarClient)
        return QStringLiteral("[]");

    const QJsonArray array = m_sidecarClient->postJsonValueSync(
                                               QStringLiteral("/conversation/indexes"),
                                               QVariantMap())
                                 .toArray();
    return QString::fromUtf8(QJsonDocument(array).toJson(QJsonDocument::Compact));
}

QString ConversationChannel::getHistoryConversationIndexes() const
{
    if (!m_sidecarClient)
        return QStringLiteral("[]");

    const QJsonArray array = m_sidecarClient->postJsonValueSync(
                                               QStringLiteral("/conversation/history-indexes"),
                                               QVariantMap())
                                 .toArray();
    return QString::fromUtf8(QJsonDocument(array).toJson(QJsonDocument::Compact));
}

bool ConversationChannel::switchMessageNext(const QString &conversationId, const QString &target, const QString &next)
{
    if (!m_sidecarClient)
        return false;

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/conversation/switch-next"),
               QVariantMap{
                   {QStringLiteral("conversationId"), conversationId},
                   {QStringLiteral("target"), target},
                   {QStringLiteral("next"), next},
               })
        .toBool();
}

void ConversationChannel::searchConversations(const QString &keyword)
{
    if (!m_sidecarClient)
        return;

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/search"),
        QVariantMap{{QStringLiteral("keyword"), keyword}});
    emit indexSearchChanged();
}

void ConversationChannel::setConversationRender(
    const QString &conversationId,
    const QString &messageId,
    const QString &renderJson)
{
    if (!m_sidecarClient)
        return;

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/set-render"),
        QVariantMap{
            {QStringLiteral("conversationId"), conversationId},
            {QStringLiteral("messageId"), messageId},
            {QStringLiteral("renderJson"), renderJson},
        });
}

QString ConversationChannel::getWorkspaceArticle(
    const QString &conversationId,
    const QString &articleId,
    int) const
{
    if (!m_sidecarClient)
        return QStringLiteral("{}");

    const QJsonObject object = m_sidecarClient->postJsonValueSync(
                                                 QStringLiteral("/conversation/get-workspace-article"),
                                                 QVariantMap{
                                                     {QStringLiteral("conversationId"), conversationId},
                                                     {QStringLiteral("articleId"), articleId},
                                                 })
                                   .toObject();
    return QString::fromUtf8(QJsonDocument(object).toJson(QJsonDocument::Compact));
}

bool ConversationChannel::updateWorkspaceArticle(
    const QString &conversationId,
    const QString &articleId,
    const QString &newContent)
{
    if (!m_sidecarClient)
        return false;

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/conversation/update-workspace-article"),
               QVariantMap{
                   {QStringLiteral("conversationId"), conversationId},
                   {QStringLiteral("articleId"), articleId},
                   {QStringLiteral("newContent"), newContent},
               })
        .toBool();
}

QString ConversationChannel::getWorkspaceOutline(const QString &conversationId, const QString &articleId) const
{
    if (!m_sidecarClient)
        return QStringLiteral("{}");

    const QJsonObject object = m_sidecarClient->postJsonValueSync(
                                                 QStringLiteral("/conversation/get-workspace-outline"),
                                                 QVariantMap{
                                                     {QStringLiteral("conversationId"), conversationId},
                                                     {QStringLiteral("articleId"), articleId},
                                                 })
                                   .toObject();
    return QString::fromUtf8(QJsonDocument(object).toJson(QJsonDocument::Compact));
}

void ConversationChannel::updateWorkspaceOutline(const QString &conversationId, const QString &outlineJson)
{
    if (!m_sidecarClient)
        return;

    m_sidecarClient->postJsonValueSync(
        QStringLiteral("/conversation/update-workspace-outline"),
        QVariantMap{
            {QStringLiteral("conversationId"), conversationId},
            {QStringLiteral("outlineJson"), outlineJson},
        });
}

bool ConversationChannel::saveWorkspaceArticleToFile(
    const QString &conversationId,
    const QString &articleId,
    const QString &format)
{
    if (!m_sidecarClient)
        return false;

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/conversation/save-workspace-article-to-file"),
               QVariantMap{
                   {QStringLiteral("conversationId"), conversationId},
                   {QStringLiteral("articleId"), articleId},
                   {QStringLiteral("format"), format},
               })
        .toBool();
}

void ConversationChannel::printHTML(const QString &, const QString &)
{
}

} // namespace hostqt
