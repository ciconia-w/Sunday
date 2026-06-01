#include "hostqt/channels/reportchannel.h"

namespace hostqt {

ReportChannel::ReportChannel(QObject *parent)
    : QObject(parent)
{
}

void ReportChannel::writeReportEvent(const QString &) {}

} // namespace hostqt

