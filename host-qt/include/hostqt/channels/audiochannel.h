#pragma once

#include <QObject>

namespace hostqt {

class AudioChannel : public QObject
{
    Q_OBJECT
public:
    explicit AudioChannel(QObject *parent = nullptr);

signals:
    void audioEvent(int event, const QString &id, const QString &json);

public slots:
    bool startRecorder(const QString &params);
    bool stopRecorder(const QString &params);
    bool playTextAudio(const QString &params);
    bool stopPlayTextAudio(const QString &params);
    QString getDeviceStatus(const QString &params) const;
};

} // namespace hostqt

