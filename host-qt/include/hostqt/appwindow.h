#pragma once

#include <QMainWindow>

QT_BEGIN_NAMESPACE
class QWebEngineView;
class QWebChannel;
class QUrl;
QT_END_NAMESPACE

namespace hostqt {

class HostContext;
class SidecarSupervisor;
class WebPage;

class AppWindow : public QMainWindow
{
    Q_OBJECT
public:
    explicit AppWindow(QWidget *parent = nullptr);
    ~AppWindow() override;

    void initialize(HostContext *context, const QUrl &appUrl);
    void setSidecarSupervisor(SidecarSupervisor *supervisor);

    void shutdown();

private:
    QWebEngineView *m_view = nullptr;
    WebPage *m_page = nullptr;
    QWebChannel *m_channel = nullptr;
    HostContext *m_context = nullptr;
    SidecarSupervisor *m_sidecarSupervisor = nullptr;
};

} // namespace hostqt
