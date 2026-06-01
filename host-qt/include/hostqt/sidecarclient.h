#pragma once

#include <QObject>
#include <QJsonArray>
#include <QJsonObject>
#include <QVariantMap>

QT_BEGIN_NAMESPACE
class QNetworkAccessManager;
class QUrl;
QT_END_NAMESPACE

namespace hostqt {

class SidecarClient : public QObject
{
    Q_OBJECT
public:
    explicit SidecarClient(QObject *parent = nullptr);
    ~SidecarClient() override;

    void setBaseUrl(const QUrl &baseUrl);
    QUrl baseUrl() const;

    QJsonObject getStateSync(QString *errorMessage = nullptr) const;
    QJsonObject postJsonSync(const QString &path, const QVariantMap &payload, QString *errorMessage = nullptr) const;
    QJsonValue postJsonValueSync(const QString &path, const QVariantMap &payload, QString *errorMessage = nullptr) const;

private:
    QUrl m_baseUrl;
    QNetworkAccessManager *m_network = nullptr;
};

} // namespace hostqt
