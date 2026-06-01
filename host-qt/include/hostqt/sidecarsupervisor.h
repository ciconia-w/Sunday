#pragma once

#include <QObject>
#include <QStringList>

QT_BEGIN_NAMESPACE
class QProcess;
QT_END_NAMESPACE

namespace hostqt {

class SidecarSupervisor : public QObject
{
    Q_OBJECT
public:
    explicit SidecarSupervisor(QObject *parent = nullptr);
    ~SidecarSupervisor() override;

    void setProgram(const QString &program);
    void setArguments(const QStringList &arguments);
    void setWorkingDirectory(const QString &workingDirectory);

    bool isRunning() const;
    QString program() const;
    QStringList arguments() const;
    QString workingDirectory() const;
    int lastExitCode() const;
    QString lastError() const;

public slots:
    void start();
    void stop();

signals:
    void started();
    void stopped(int exitCode);
    void errorChanged(const QString &error);

private:
    QProcess *m_process = nullptr;
    QString m_program;
    QStringList m_arguments;
    QString m_workingDirectory;
    int m_lastExitCode = 0;
    QString m_lastError;
};

} // namespace hostqt

