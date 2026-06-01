#pragma once

#include <QObject>
#include <QJsonObject>

namespace hostqt {

class SidecarClient;

class ServiceConfigChannel : public QObject
{
    Q_OBJECT
public:
    explicit ServiceConfigChannel(QObject *parent = nullptr);
    void setSidecarClient(SidecarClient *client);

signals:
    void knowledgeBaseChanged(bool);
    void embeddingPluginsChanged(bool);
    void mcpPluginChanged(bool);

public slots:
    bool checkKnowledgeBase() const;
    bool checkEmbeddingPlugins() const;
    bool isMcpRuntimeReady() const;
    bool checkDocumentConversionCapability() const;
    QJsonObject getRuntimeStatus() const;
    QJsonObject getModelConfig() const;
    QJsonObject saveModelConfig(
        const QString &provider,
        const QString &model,
        const QString &availableModels,
        const QString &providerApiKey) const;
    bool getMcpThirdPartyAgreement() const;
    void setMcpThirdPartyAgreement(bool agreed);
    QJsonObject getMcpServices() const;

private:
    SidecarClient *m_sidecarClient = nullptr;
};

} // namespace hostqt
