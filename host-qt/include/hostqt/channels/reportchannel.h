#pragma once

#include <QObject>

namespace hostqt {

class ReportChannel : public QObject
{
    Q_OBJECT
public:
    explicit ReportChannel(QObject *parent = nullptr);

public slots:
    void writeReportEvent(const QString &jsonData);
};

} // namespace hostqt

