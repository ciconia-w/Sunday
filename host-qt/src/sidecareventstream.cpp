#include "hostqt/sidecareventstream.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

namespace hostqt {


SidecarEventStream::SidecarEventStream(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
    , m_flushTimer(new QTimer(this))
{
    m_flushTimer->setInterval(16);
    connect(m_flushTimer, &QTimer::timeout, this, &SidecarEventStream::flushQueue);
}

SidecarEventStream::~SidecarEventStream()
{
    stop();
}

void SidecarEventStream::setBaseUrl(const QUrl &baseUrl)
{
    m_baseUrl = baseUrl;
}

QUrl SidecarEventStream::baseUrl() const
{
    return m_baseUrl;
}

bool SidecarEventStream::isRunning() const
{
    return m_reply != nullptr;
}

void SidecarEventStream::start()
{
    if (isRunning() || !m_baseUrl.isValid()) {
        return;
    }

    QNetworkRequest request(m_baseUrl.resolved(QUrl(QStringLiteral("/events"))));
    m_reply = m_network->get(request);
    connect(m_reply, &QNetworkReply::readyRead, this, &SidecarEventStream::handleReadyRead);
    connect(m_reply, &QNetworkReply::errorOccurred, this, [this](QNetworkReply::NetworkError) {
        emit streamError(m_reply ? m_reply->errorString() : QStringLiteral("Unknown stream error"));
    });
    connect(m_reply, &QNetworkReply::finished, this, [this]() {
        if (m_reply && m_reply->error() != QNetworkReply::NoError) {
            emit streamError(m_reply->errorString());
        }
        if (m_reply) {
            m_reply->deleteLater();
            m_reply = nullptr;
        }
    });
}

void SidecarEventStream::stop()
{
    if (!m_reply) {
        return;
    }

    QNetworkReply *reply = m_reply;
    m_reply = nullptr;
    m_buffer.clear();
    m_eventQueue.clear();
    m_flushTimer->stop();
    reply->disconnect(this);
    reply->abort();
    delete reply;
}

void SidecarEventStream::handleReadyRead()
{
    if (!m_reply) {
        return;
    }

    m_buffer.append(m_reply->readAll());
    parseBufferedChunks();
}

void SidecarEventStream::parseBufferedChunks()
{
    while (true) {
        const int separator = m_buffer.indexOf("\n\n");
        if (separator < 0) {
            return;
        }

        const QByteArray block = m_buffer.left(separator);
        m_buffer.remove(0, separator + 2);

        QByteArray eventName;
        QByteArray dataLine;

        const QList<QByteArray> lines = block.split('\n');
        for (const QByteArray &line : lines) {
            if (line.startsWith("event:")) {
                eventName = line.mid(6).trimmed();
            } else if (line.startsWith("data:")) {
                dataLine = line.mid(5).trimmed();
            }
        }

        if (eventName != "session" || dataLine.isEmpty()) {
            continue;
        }

        const QJsonObject obj = QJsonDocument::fromJson(dataLine).object();
        QueuedEvent ev;
        ev.event = obj.value(QStringLiteral("event")).toInt();
        ev.sessionId = obj.value(QStringLiteral("sessionId")).toString();
        ev.message = obj.value(QStringLiteral("message")).toString();
        m_eventQueue.append(ev);

        if (!m_flushTimer->isActive()) {
            m_flushTimer->start();
        }
    }
}

void SidecarEventStream::flushQueue()
{
    if (m_eventQueue.isEmpty()) {
        m_flushTimer->stop();
        return;
    }

    const QueuedEvent ev = m_eventQueue.takeFirst();
    emit sessionEvent(ev.event, ev.sessionId, ev.message);

    if (m_eventQueue.isEmpty()) {
        m_flushTimer->stop();
    }
}

} // namespace hostqt
