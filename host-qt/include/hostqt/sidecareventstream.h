#pragma once

#include <QObject>
#include <QUrl>
#include <QList>

QT_BEGIN_NAMESPACE
class QTimer;
class QNetworkAccessManager;
class QNetworkReply;
QT_END_NAMESPACE

namespace hostqt {

struct QueuedEvent {
    int event;
    QString sessionId;
    QString message;
};

class SidecarEventStream : public QObject
{
    Q_OBJECT
public:
    explicit SidecarEventStream(QObject *parent = nullptr);
    ~SidecarEventStream() override;

    void setBaseUrl(const QUrl &baseUrl);
    QUrl baseUrl() const;

    bool isRunning() const;

public slots:
    void start();
    void stop();

signals:
    void sessionEvent(int event, const QString &id, const QString &json);
    void streamError(const QString &message);

private:
    void handleReadyRead();
    void flushQueue();
    void parseBufferedChunks();

    QUrl m_baseUrl;
    QNetworkAccessManager *m_network = nullptr;
    QNetworkReply *m_reply = nullptr;
    QByteArray m_buffer;
    QTimer *m_flushTimer = nullptr;
    QList<struct QueuedEvent> m_eventQueue;
};

} // namespace hostqt

