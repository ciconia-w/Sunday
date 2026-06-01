#include "hostqt/channels/audiochannel.h"

namespace hostqt {

AudioChannel::AudioChannel(QObject *parent)
    : QObject(parent)
{
}

bool AudioChannel::startRecorder(const QString &) { return false; }
bool AudioChannel::stopRecorder(const QString &) { return false; }
bool AudioChannel::playTextAudio(const QString &) { return false; }
bool AudioChannel::stopPlayTextAudio(const QString &) { return false; }
QString AudioChannel::getDeviceStatus(const QString &) const
{
    return QStringLiteral(R"({"hasInputDevice":false,"hasOutputDevice":false})");
}

} // namespace hostqt

