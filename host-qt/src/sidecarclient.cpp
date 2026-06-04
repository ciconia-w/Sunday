#include "hostqt/sidecarclient.h"

#include <QEventLoop>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrl>

namespace hostqt {

SidecarClient::SidecarClient(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
{
}

SidecarClient::~SidecarClient() = default;

void SidecarClient::setBaseUrl(const QUrl &baseUrl)
{
    m_baseUrl = baseUrl;
}

QUrl SidecarClient::baseUrl() const
{
    return m_baseUrl;
}

QJsonObject SidecarClient::getStateSync(QString *errorMessage) const
{
    if (!m_baseUrl.isValid()) {
        if (errorMessage)
            *errorMessage = QStringLiteral("Sidecar base URL is invalid");
        return QJsonObject();
    }

    QNetworkRequest request(m_baseUrl.resolved(QUrl(QStringLiteral("/state"))));
    QNetworkReply *reply = m_network->get(request);

    QEventLoop loop;
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();

    if (reply->error() != QNetworkReply::NoError) {
        if (errorMessage)
            *errorMessage = reply->errorString();
        delete reply;
        return QJsonObject();
    }

    const QByteArray raw = reply->readAll();
    delete reply;
    return QJsonDocument::fromJson(raw).object();
}

QJsonObject SidecarClient::postJsonSync(const QString &path, const QVariantMap &payload, QString *errorMessage) const
{
    const QJsonValue value = postJsonValueSync(path, payload, errorMessage);
    return value.toObject();
}

QJsonValue SidecarClient::postJsonValueSync(const QString &path, const QVariantMap &payload, QString *errorMessage) const
{
    if (!m_baseUrl.isValid()) {
        if (errorMessage)
            *errorMessage = QStringLiteral("Sidecar base URL is invalid");
        return QJsonValue();
    }

    QNetworkRequest request(m_baseUrl.resolved(QUrl(path)));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));

    const QByteArray body = QJsonDocument(QJsonObject::fromVariantMap(payload)).toJson(QJsonDocument::Compact);
    QNetworkReply *reply = m_network->post(request, body);

    QEventLoop loop;
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();

    if (reply->error() != QNetworkReply::NoError) {
        const QByteArray raw = reply->readAll();
        const QJsonObject root = QJsonDocument::fromJson(raw).object();
        const QString detailedError = root.value(QStringLiteral("error")).toString();
        if (errorMessage)
            *errorMessage = detailedError.isEmpty() ? reply->errorString() : detailedError;
        delete reply;
        return QJsonValue();
    }

    const QByteArray raw = reply->readAll();
    delete reply;
    const QJsonObject root = QJsonDocument::fromJson(raw).object();
    if (root.contains(QStringLiteral("ok")) && !root.value(QStringLiteral("ok")).toBool(true)) {
        if (errorMessage)
            *errorMessage = root.value(QStringLiteral("error")).toString();
        return QJsonValue();
    }
    return root.value(QStringLiteral("result"));
}

} // namespace hostqt
