#include "hostqt/channels/windowchannel.h"

namespace hostqt {

WindowChannel::WindowChannel(QObject *parent)
    : QObject(parent)
{
}

int WindowChannel::windowMode() const { return m_windowMode; }
void WindowChannel::switchMode(int mode)
{
    m_windowMode = mode;
    emit windowModeChanged(mode);
}
void WindowChannel::minimize() {}
void WindowChannel::maximize() {}
void WindowChannel::restore() {}
void WindowChannel::close() {}
void WindowChannel::startMove(int, int, int, int) {}
void WindowChannel::systemMenu() {}
void WindowChannel::ensureMinimumWidth(int) {}
void WindowChannel::saveMainWindowSidebarState(int, bool) {}
void WindowChannel::saveMainWindowSidebarGroupCollapsedStates(const QString &) {}
QJsonObject WindowChannel::getMainWindowSidebarState() const
{
    return QJsonObject{{"sidebarWidth", 220}, {"sidebarExpanded", true}, {"groupCollapsedStates", QJsonObject{}}};
}
bool WindowChannel::isMainWindowActive() const { return true; }
bool WindowChannel::shouldShowNewUserGuideOnStartup() const { return false; }
void WindowChannel::recordNewUserGuideShown() {}
void WindowChannel::showConfig(int) {}
void WindowChannel::showHelpWindow() {}
void WindowChannel::showAboutWindow() {}
void WindowChannel::showUpdateLogWindow() {}

} // namespace hostqt

