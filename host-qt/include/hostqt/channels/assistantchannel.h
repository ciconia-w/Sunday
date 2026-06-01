#pragma once

#include <QObject>
#include <QJsonArray>

namespace hostqt {

class SidecarClient;

class AssistantChannel : public QObject
{
    Q_OBJECT
public:
    explicit AssistantChannel(QObject *parent = nullptr);
    void setSidecarClient(SidecarClient *client);

signals:
    void assistantChanged();
    void modelListChanged();

public slots:
    QJsonArray getAssistantList() const;
    QString getCurrentModel(const QString &assistantId) const;
    QJsonArray getModelList(const QString &assistantId) const;
    bool setCurrentModel(const QString &modelId, const QString &assistantId);
    QJsonArray getAssistantOrder() const;
    void setAssistantOrder(const QJsonArray &order);
    int getAssistantVisibleCount() const;
    void setAssistantVisibleCount(int count);
    QString getRecentWritingDocs() const;
    QString getWritingTemplates() const;
    QString getTranslationFAQ() const;
    QString getClawFAQ() const;
    void requestAddModel();
    void claimUsageRequest(const QString &modelId);

private:
    SidecarClient *m_sidecarClient = nullptr;
};

} // namespace hostqt
