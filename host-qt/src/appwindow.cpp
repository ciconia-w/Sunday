#include "hostqt/appwindow.h"
#include "hostqt/hostcontext.h"
#include "hostqt/sidecarsupervisor.h"
#include "hostqt/webpage.h"

#include <QWebChannel>
#include <QDebug>
#include <QWebEngineView>

namespace hostqt {

AppWindow::AppWindow(QWidget *parent)
    : QMainWindow(parent)
{
    resize(1200, 840);
    setWindowTitle(QStringLiteral("Sunday"));
}

AppWindow::~AppWindow()
{
    shutdown();
}

void AppWindow::initialize(HostContext *context, const QUrl &appUrl)
{
    m_context = context;
    m_view = new QWebEngineView(this);
    m_page = new WebPage(m_view);
    m_view->setPage(m_page);
    m_channel = new QWebChannel(m_page);

    if (m_context) {
        m_channel->registerObject("windowObj", m_context->window);
        m_channel->registerObject("systemObj", m_context->system);
        m_channel->registerObject("fileObj", m_context->file);
        m_channel->registerObject("taskObj", m_context->task);
        m_channel->registerObject("audioObj", m_context->audio);
        m_channel->registerObject("sessObj", m_context->session);
        m_channel->registerObject("assistObj", m_context->assistant);
        m_channel->registerObject("conversationObj", m_context->conversation);
        m_channel->registerObject("serviceConfigObj", m_context->serviceConfig);
        m_channel->registerObject("skillsMgr", m_context->skills);
        m_channel->registerObject("reportObj", m_context->report);
    }

    m_page->setWebChannel(m_channel);
    setCentralWidget(m_view);
    connect(m_view, &QWebEngineView::loadFinished, this, [](bool ok) {
        qWarning() << "[host-qt web] loadFinished" << ok;
    });
    m_view->setUrl(appUrl);
}

void AppWindow::setSidecarSupervisor(SidecarSupervisor *supervisor)
{
    m_sidecarSupervisor = supervisor;
}

void AppWindow::shutdown()
{
    if (m_view) {
        m_view->stop();
        m_view->setPage(nullptr);
    }

    if (m_page) {
        m_page->setWebChannel(nullptr);
    }

    if (m_channel) {
        m_channel->disconnect();
    }

    m_channel = nullptr;
    m_page = nullptr;
    m_view = nullptr;
    m_context = nullptr;
    m_sidecarSupervisor = nullptr;
}

} // namespace hostqt
