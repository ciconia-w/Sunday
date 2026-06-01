#include "hostqt/channels/taskchannel.h"

namespace hostqt {

TaskChannel::TaskChannel(QObject *parent)
    : QObject(parent)
{
}

void TaskChannel::onWindowCreated() {}

} // namespace hostqt

