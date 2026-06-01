#pragma once

#include <QObject>

namespace hostqt {

class SidecarClient;
class SidecarEventStream;

class SessionChannel : public QObject
{
    Q_OBJECT
public:
    explicit SessionChannel(QObject *parent = nullptr);
    void setSidecarClient(SidecarClient *client);
    void setSidecarEventStream(SidecarEventStream *stream);

signals:
    void sessionEvent(int event, const QString &id, const QString &json);

public slots:
    void sendMessage(const QString &params);
    void retry(const QString &params);
    void cancel(const QString &params);
    void invokeAction(const QString &sessionId, const QString &json);

private:
    SidecarClient *m_sidecarClient = nullptr;
    SidecarEventStream *m_sidecarEventStream = nullptr;
};

} // namespace hostqt
