#pragma once

#include <QObject>

namespace hostqt {

class TaskChannel : public QObject
{
    Q_OBJECT
public:
    explicit TaskChannel(QObject *parent = nullptr);

signals:
    void taskAdded(int mode);

public slots:
    void onWindowCreated();
};

} // namespace hostqt

