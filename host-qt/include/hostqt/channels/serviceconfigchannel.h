#pragma once

#include <QObject>
#include <QJsonArray>
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
    QJsonArray getCliToolsState() const;
    QJsonObject getBrowserControlState() const;
    QJsonObject setBrowserControlEnabled(bool enabled) const;
    QJsonObject getBrowserPanelState() const;
    QJsonObject startBrowserSessionIfEnabled() const;
    QJsonObject initBrowserSession() const;
    QJsonObject browserOpenUrl(const QString &url) const;
    QJsonObject browserNewTab(const QString &url) const;
    QJsonObject browserSelectTab(const QString &pageId) const;
    QJsonObject browserExtractPage() const;
    QJsonObject browserCaptureScreenshot(const QString &outputPath) const;
    QJsonObject getModelConfig() const;
    QJsonObject saveModelConfig(
        const QString &provider,
        const QString &model,
        const QString &availableModels,
        const QString &providerApiKey) const;
    bool getMcpThirdPartyAgreement() const;
    void setMcpThirdPartyAgreement(bool agreed);
    QJsonObject getMcpServices() const;
    QJsonObject refreshMcpRuntime() const;
    QJsonObject setMcpServiceEnabled(const QString &serviceId, bool enabled) const;
    QJsonObject saveMcpService(const QString &jsonConfig, const QString &description, const QString &serviceId = QString()) const;
    QJsonObject deleteMcpService(const QString &serviceId) const;
    bool installApp(const QString &appId) const;

private:
    SidecarClient *m_sidecarClient = nullptr;
};

} // namespace hostqt
