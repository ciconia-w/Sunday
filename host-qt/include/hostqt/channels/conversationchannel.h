#pragma once

#include <QObject>
#include <QJsonObject>

namespace hostqt {

class SidecarClient;

class ConversationChannel : public QObject
{
    Q_OBJECT
public:
    explicit ConversationChannel(QObject *parent = nullptr);
    void setSidecarClient(SidecarClient *client);

signals:
    void changeToConversation(const QString &assistantId, const QString &conversationId);
    void indexSearchChanged();

public slots:
    QJsonObject getConversation(const QString &id) const;
    void deleteConversation(const QStringList &ids);
    void releaseConversation(const QStringList &ids);
    bool saveConversation(const QString &id);
    QString getConversationIndexes() const;
    QString getHistoryConversationIndexes() const;
    bool switchMessageNext(const QString &conversationId, const QString &target, const QString &next);
    void searchConversations(const QString &keyword);
    void setConversationRender(const QString &conversationId, const QString &messageId, const QString &renderJson);
    QString getWorkspaceArticle(const QString &conversationId, const QString &articleId, int version = -1) const;
    bool updateWorkspaceArticle(const QString &conversationId, const QString &articleId, const QString &newContent);
    QString getWorkspaceOutline(const QString &conversationId, const QString &articleId) const;
    void updateWorkspaceOutline(const QString &conversationId, const QString &outlineJson);
    bool saveWorkspaceArticleToFile(const QString &conversationId, const QString &articleId, const QString &format);
    void printHTML(const QString &html, const QString &title);

private:
    SidecarClient *m_sidecarClient = nullptr;
};

} // namespace hostqt
