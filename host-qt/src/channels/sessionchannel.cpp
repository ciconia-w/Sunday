#include "hostqt/channels/sessionchannel.h"
#include "hostqt/sidecarclient.h"
#include "hostqt/sidecareventstream.h"

#include <QVariantMap>

namespace hostqt {

SessionChannel::SessionChannel(QObject *parent)
    : QObject(parent)
{
}

void SessionChannel::setSidecarClient(SidecarClient *client)
{
    m_sidecarClient = client;
}

void SessionChannel::setSidecarEventStream(SidecarEventStream *stream)
{
    if (m_sidecarEventStream == stream)
        return;

    if (m_sidecarEventStream) {
        disconnect(m_sidecarEventStream, nullptr, this, nullptr);
    }

    m_sidecarEventStream = stream;
    if (!m_sidecarEventStream)
        return;

    connect(m_sidecarEventStream, &SidecarEventStream::sessionEvent, this, &SessionChannel::sessionEvent);
}

void SessionChannel::sendMessage(const QString &params)
{
    if (!m_sidecarClient)
        return;
    m_sidecarClient->postJsonSync(QStringLiteral("/session/send"), QVariantMap{{QStringLiteral("params"), params}});
}

void SessionChannel::retry(const QString &params)
{
    if (!m_sidecarClient)
        return;
    m_sidecarClient->postJsonSync(QStringLiteral("/session/retry"), QVariantMap{{QStringLiteral("params"), params}});
}

void SessionChannel::cancel(const QString &params)
{
    if (!m_sidecarClient)
        return;
    m_sidecarClient->postJsonSync(QStringLiteral("/session/cancel"), QVariantMap{{QStringLiteral("params"), params}});
}

void SessionChannel::invokeAction(const QString &sessionId, const QString &json)
{
    if (!m_sidecarClient)
        return;
    m_sidecarClient->postJsonSync(
        QStringLiteral("/session/action"),
        QVariantMap{
            {QStringLiteral("sessionId"), sessionId},
            {QStringLiteral("json"), json},
        });
}

} // namespace hostqt
