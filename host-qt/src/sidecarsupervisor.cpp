#include "hostqt/sidecarsupervisor.h"

#include <QProcess>

namespace hostqt {

SidecarSupervisor::SidecarSupervisor(QObject *parent)
    : QObject(parent)
    , m_process(new QProcess(this))
{
    connect(m_process, &QProcess::started, this, &SidecarSupervisor::started);
    connect(m_process, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this, [this](int exitCode, QProcess::ExitStatus) {
        m_lastExitCode = exitCode;
        emit stopped(exitCode);
    });
    connect(m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        m_lastError = m_process->errorString();
        emit errorChanged(m_lastError);
    });
}

SidecarSupervisor::~SidecarSupervisor()
{
    stop();
}

void SidecarSupervisor::setProgram(const QString &program)
{
    m_program = program;
}

void SidecarSupervisor::setArguments(const QStringList &arguments)
{
    m_arguments = arguments;
}

void SidecarSupervisor::setWorkingDirectory(const QString &workingDirectory)
{
    m_workingDirectory = workingDirectory;
}

bool SidecarSupervisor::isRunning() const
{
    return m_process->state() != QProcess::NotRunning;
}

QString SidecarSupervisor::program() const
{
    return m_program;
}

QStringList SidecarSupervisor::arguments() const
{
    return m_arguments;
}

QString SidecarSupervisor::workingDirectory() const
{
    return m_workingDirectory;
}

int SidecarSupervisor::lastExitCode() const
{
    return m_lastExitCode;
}

QString SidecarSupervisor::lastError() const
{
    return m_lastError;
}

void SidecarSupervisor::start()
{
    if (isRunning() || m_program.isEmpty()) {
        return;
    }

    if (!m_workingDirectory.isEmpty()) {
        m_process->setWorkingDirectory(m_workingDirectory);
    }
    m_process->start(m_program, m_arguments);
}

void SidecarSupervisor::stop()
{
    if (!isRunning()) {
        return;
    }

    m_process->terminate();
    if (!m_process->waitForFinished(1500)) {
        m_process->kill();
        m_process->waitForFinished(1500);
    }
}

} // namespace hostqt

